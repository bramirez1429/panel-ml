import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TiendaNegocioConnectionRepository } from '../connections/tiendanegocio-connection.repository';

// La documentación oficial enumera dos hosts para el canje de OAuth.
const TOKEN_ENDPOINTS = [
  'https://developers.tiendanegocio.com/v1/oauth/app/token',
  'https://api.tiendanegocio.com/referrer/api/v1/oauth/app/token',
] as const;
const INSTALL_URL = 'https://panel.tiendanegocio.com/';
const APP_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,80}$/;
const STORE_ID_PATTERN = /^[1-9]\d*$/;

@Injectable()
export class TiendaNegocioOAuthService {
  private readonly logger = new Logger(TiendaNegocioOAuthService.name);

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
    // Solo probar la segunda ruta si la primera no existe.
    // Nunca repetir el canje ante 400/401/403 ni tras un timeout:
    // el código OAuth es de un solo uso y expira en 1 minuto.
    let response: Response | null = null;
    for (const [index, endpoint] of TOKEN_ENDPOINTS.entries()) {
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: this.required('TIENDANEGOCIO_APP_ID'),
            client_secret: this.required('TIENDANEGOCIO_APP_SECRET'),
            grant_type: 'authorization_code',
            code: code.trim(),
          }),
          signal: AbortSignal.timeout(12_000),
          cache: 'no-store',
        });
      } catch (error) {
        this.logFailure('network_error', { error });
        throw new BadGatewayException('Error de red autorizando Tienda Negocio');
      }
      if (index === 0 && (response.status === 404 || response.status === 405)) {
        this.logFailure('endpoint_unavailable', { status: response.status });
        continue;
      }
      break;
    }
    if (!response) {
      throw new BadGatewayException('No se pudo contactar a Tienda Negocio');
    }
    if (!response.ok) {
      this.logFailure('token_exchange_rejected', { status: response.status });
      throw this.exchangeFailure(response.status);
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch (error) {
      this.logFailure('invalid_token_response', { error });
      throw new BadGatewayException('Respuesta OAuth inválida de Tienda Negocio');
    }
    if (!isRecord(result) || typeof result.access_token !== 'string' ||
      result.access_token.length < 12) {
      throw new BadGatewayException('Respuesta OAuth incompleta de Tienda Negocio');
    }
    const storeId = String(result.store_id ?? result.client_id ?? '').trim();
    if (!STORE_ID_PATTERN.test(storeId)) {
      throw new BadGatewayException('No se recibió el ID de tienda autorizado');
    }
    try {
      await this.connections.save({
        user_id: userId,
        store_id: storeId,
        access_token: result.access_token,
        scope: typeof result.scope === 'string' ? result.scope : '',
      });
    } catch (error) {
      this.logFailure('connection_persistence_failed', { error });
      throw error;
    }
    this.logger.log(JSON.stringify({ event: 'tiendanegocio_oauth_exchange_succeeded' }));
    return { storeId };
  }

  private exchangeFailure(status: number): BadGatewayException | BadRequestException {
    if (status === 400 || status === 422) {
      return new BadRequestException('Código OAuth inválido, vencido o ya utilizado');
    }
    if (status === 401 || status === 403) {
      return new BadGatewayException('Tienda Negocio rechazó las credenciales de la aplicación');
    }
    if (status === 404 || status === 405) {
      return new BadGatewayException('Endpoint OAuth de Tienda Negocio no disponible');
    }
    return new BadGatewayException('No se pudo autorizar la aplicación en Tienda Negocio');
  }

  private logFailure(
    event: string,
    context: { status?: number; error?: unknown },
  ): void {
    const errorName = context.error instanceof Error ? context.error.name : undefined;
    this.logger.warn(JSON.stringify({
      event: `tiendanegocio_oauth_${event}`,
      ...(context.status ? { status: context.status } : {}),
      ...(errorName ? { errorName } : {}),
    }));
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
