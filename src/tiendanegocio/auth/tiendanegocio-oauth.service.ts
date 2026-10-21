import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TiendaNegocioConnectionRepository } from '../connections/tiendanegocio-connection.repository';

const TOKEN_ENDPOINT = 'https://developers.tiendanegocio.com/v1/oauth/app/token';
const INSTALL_URL = 'https://panel.tiendanegocio.com/';
const APP_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,80}$/;
const STORE_ID_PATTERN = /^[1-9]\d*$/;

@Injectable()
export class TiendaNegocioOAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly connections: TiendaNegocioConnectionRepository,
  ) {}

  /** Solo muestra si el backend tiene las tres variables necesarias. */
  isConfigured(): boolean {
    const id = this.config.get<string>('TIENDANEGOCIO_APP_ID')?.trim();
    const secret = this.config.get<string>('TIENDANEGOCIO_APP_SECRET')?.trim();
    const handle = this.config.get<string>('TIENDANEGOCIO_APP_HANDLE')?.trim();
    return Boolean(id && secret && handle && APP_HANDLE_PATTERN.test(handle));
  }

  getInstallationUrl(): string {
    const handle = this.required('TIENDANEGOCIO_APP_HANDLE');
    if (!APP_HANDLE_PATTERN.test(handle)) {
      throw new ServiceUnavailableException('Identificador de app Tienda Negocio inválido');
    }
    return `${INSTALL_URL}#/tienda-de-aplicaciones/${handle}/permisos`;
  }

  async exchange(userId: string, code: string): Promise<{ storeId: string }> {
    if (!code?.trim() || code.length > 4096) {
      throw new BadRequestException('Código de autorización inválido');
    }
    let response: Response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: this.required('TIENDANEGOCIO_APP_ID'),
          client_secret: this.required('TIENDANEGOCIO_APP_SECRET'),
          grant_type: 'authorization_code',
          code: code.trim(),
        }),
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      });
    } catch {
      throw new BadGatewayException('Error de red autorizando Tienda Negocio');
    }
    if (!response.ok) {
      throw new BadGatewayException('No se pudo autorizar la aplicación en Tienda Negocio');
    }
    const result: unknown = await response.json();
    if (!isRecord(result) || typeof result.access_token !== 'string' ||
      result.access_token.length < 12) {
      throw new BadGatewayException('Respuesta OAuth incompleta de Tienda Negocio');
    }
    const storeId = String(result.store_id ?? result.client_id ?? '').trim();
    if (!STORE_ID_PATTERN.test(storeId)) {
      throw new BadGatewayException('No se recibió el ID de tienda autorizado');
    }
    await this.connections.save({
      user_id: userId,
      store_id: storeId,
      access_token: result.access_token,
      scope: typeof result.scope === 'string' ? result.scope : '',
    });
    return { storeId };
  }

  private required(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(
        'Falta configurar la aplicación OAuth de Tienda Negocio',
      );
    }
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
