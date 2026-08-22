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

type InFlightRefresh = {
  sellerId: number;
  refreshToken: string;
  promise: Promise<string>;
};

@Injectable()
export class MercadolibreTokenService {
  private readonly inFlightRefreshes = new Map<string, InFlightRefresh>();

  /** Recibe las dependencias para administrar tokens. */
  constructor(
    private readonly configService: ConfigService,
    private readonly apiService: MercadolibreApiService,
    private readonly supabaseService: SupabaseService,
    private readonly authService: MercadolibreAuthService,
  ) {}

  /** Lee exclusivamente la conexión del usuario autenticado. */
  async getStoredConnection(userId: string): Promise<MercadoLibreConnection> {
    const connection = await this.supabaseService.getConnection(userId);
    if (!connection) {
      throw new UnauthorizedException(
        'Primero conectá Mercado Libre desde /mercadolibre/connect',
      );
    }
    return this.requireOwnedConnection(userId, connection);
  }

  /** Resuelve el owner interno de una notificacion identificada por seller. */
  async getStoredConnectionBySellerId(
    sellerId: number,
  ): Promise<MercadoLibreConnection> {
    const connection =
      await this.supabaseService.getConnectionBySellerId(sellerId);
    if (!connection || connection.seller_id !== sellerId) {
      throw new UnauthorizedException(
        'No existe una conexi\u00f3n de Mercado Libre para el vendedor',
      );
    }
    return connection;
  }

  /** Devuelve un access token vigente o lo renueva. */
  async getValidAccessToken(
    userId: string,
    storedConnection?: MercadoLibreConnection,
  ): Promise<string> {
    const connection = this.requireOwnedConnection(
      userId,
      storedConnection ?? (await this.getStoredConnection(userId)),
    );
    const remainingTime = Date.parse(connection.expires_at) - Date.now();
    if (
      Number.isFinite(remainingTime) &&
      remainingTime > TOKEN_REFRESH_MARGIN_MS
    ) {
      return connection.access_token;
    }
    return this.getOrStartRefresh(userId, connection);
  }

  /** Renueva el access token y guarda el reemplazo. */
  async refreshAccessToken(
    userId: string,
    connection: MercadoLibreConnection,
  ): Promise<string> {
    this.requireOwnedConnection(userId, connection);
    try {
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

      await this.authService.saveRefreshedTokens(userId, connection, tokens);
      return tokens.access_token;
    } catch (error) {
      const replacement = await this.getConcurrentReplacement(
        userId,
        connection,
      );
      if (replacement) return replacement;
      throw error;
    }
  }

  /** Comparte un refresh concurrente del mismo token dentro del proceso. */
  private async getOrStartRefresh(
    userId: string,
    connection: MercadoLibreConnection,
  ): Promise<string> {
    const current = this.inFlightRefreshes.get(userId);
    if (
      current?.sellerId === connection.seller_id &&
      current.refreshToken === connection.refresh_token
    ) {
      return current.promise;
    }

    const entry: InFlightRefresh = {
      sellerId: connection.seller_id,
      refreshToken: connection.refresh_token,
      promise: this.refreshAccessToken(userId, connection),
    };
    this.inFlightRefreshes.set(userId, entry);
    try {
      return await entry.promise;
    } finally {
      if (this.inFlightRefreshes.get(userId) === entry) {
        this.inFlightRefreshes.delete(userId);
      }
    }
  }

  /** Impide usar una conexión obtenida para otro usuario de la app. */
  private requireOwnedConnection(
    userId: string,
    connection: MercadoLibreConnection,
  ): MercadoLibreConnection {
    if (connection.user_id !== userId) {
      throw new UnauthorizedException(
        'Primero conectá Mercado Libre desde /mercadolibre/connect',
      );
    }
    return connection;
  }

  /** Recupera el token que otro worker pudo haber renovado primero. */
  private async getConcurrentReplacement(
    userId: string,
    previous: MercadoLibreConnection,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let current: MercadoLibreConnection | null;
      try {
        current = await this.supabaseService.getConnection(userId);
      } catch {
        current = null;
      }

      if (current) {
        if (
          current.user_id !== userId ||
          current.seller_id !== previous.seller_id
        ) {
          return null;
        }

        const wasReplaced =
          current.refresh_token !== previous.refresh_token ||
          current.access_token !== previous.access_token ||
          current.expires_at !== previous.expires_at;
        const remainingTime = Date.parse(current.expires_at) - Date.now();
        if (
          wasReplaced &&
          Number.isFinite(remainingTime) &&
          remainingTime > TOKEN_REFRESH_MARGIN_MS
        ) {
          return current.access_token;
        }
      }

      if (attempt < 3) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50 * 2 ** attempt);
        });
      }
    }
    return null;
  }

  /** Lee una variable obligatoria de Mercado Libre. */
  private getRequiredConfig(
    key: Parameters<typeof getRequiredMercadoLibreConfig>[1],
  ): string {
    return getRequiredMercadoLibreConfig(this.configService, key);
  }
}
