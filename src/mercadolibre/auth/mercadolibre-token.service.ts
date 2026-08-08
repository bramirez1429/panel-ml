import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MercadoLibreConnection,
  SupabaseService,
} from '../../database/supabase.service';
import {
  getRequiredMercadoLibreConfig,
  TOKEN_REFRESH_MARGIN_MS,
} from '../shared/mercadolibre.config';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { parseMercadoLibreTokens } from '../shared/mercadolibre.types';
import { MercadolibreAuthService } from './mercadolibre-auth.service';

@Injectable()
export class MercadolibreTokenService {
  /** Recibe las dependencias para administrar tokens. */
  constructor(
    private readonly configService: ConfigService,
    private readonly apiService: MercadolibreApiService,
    private readonly supabaseService: SupabaseService,
    private readonly authService: MercadolibreAuthService,
  ) {}

  /** Lee la conexión guardada o indica cómo crearla. */
  async getStoredConnection(): Promise<MercadoLibreConnection> {
    const connection = await this.supabaseService.getConnection();
    if (!connection) {
      throw new UnauthorizedException(
        'Primero conectá Mercado Libre desde /mercadolibre/connect',
      );
    }
    return connection;
  }

  /** Devuelve un access token vigente o lo renueva. */
  async getValidAccessToken(
    storedConnection?: MercadoLibreConnection,
  ): Promise<string> {
    const connection = storedConnection ?? (await this.getStoredConnection());
    const remainingTime = Date.parse(connection.expires_at) - Date.now();
    if (
      Number.isFinite(remainingTime) &&
      remainingTime > TOKEN_REFRESH_MARGIN_MS
    ) {
      return connection.access_token;
    }
    return this.refreshAccessToken(connection);
  }

  /** Renueva el access token y guarda el reemplazo. */
  async refreshAccessToken(
    connection: MercadoLibreConnection,
  ): Promise<string> {
    const response = await this.apiService.postForm<unknown>(
      '/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.getRequiredConfig('ML_CLIENT_ID'),
        client_secret: this.getRequiredConfig('ML_CLIENT_SECRET'),
        refresh_token: connection.refresh_token,
      }),
      'tokenExchange',
    );
    const tokens = parseMercadoLibreTokens(response);

    await this.authService.saveTokens(
      { id: connection.seller_id, nickname: connection.nickname },
      tokens,
    );
    return tokens.access_token;
  }

  /** Lee una variable obligatoria de Mercado Libre. */
  private getRequiredConfig(
    key: Parameters<typeof getRequiredMercadoLibreConfig>[1],
  ): string {
    return getRequiredMercadoLibreConfig(this.configService, key);
  }
}
