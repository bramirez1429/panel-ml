import { HttpException, Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';

export type MercadoLibreIntegrationStatus =
  | { connected: true; reconnectRequired: false; sellerId: number }
  | { connected: false; reconnectRequired: true; sellerId: number }
  | { connected: false; reconnectRequired: false };

const RECONNECTABLE_OAUTH_ERRORS = new Set([
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
]);

@Injectable()
export class MercadolibreIntegrationStatusService {
  constructor(private readonly tokenService: MercadolibreTokenService) {}

  async getStatus(userId: string): Promise<MercadoLibreIntegrationStatus> {
    const storedStatus = await this.tokenService.getConnectionStatus(userId);
    if (!storedStatus.connected) {
      return { connected: false, reconnectRequired: false };
    }

    const connection = await this.tokenService.getSharedStoredConnection();
    try {
      await this.tokenService.getSharedValidAccessToken(connection);
      return {
        connected: true,
        reconnectRequired: false,
        sellerId: connection.seller_id,
      };
    } catch (error) {
      if (!isReconnectRequiredError(error)) throw error;
      return {
        connected: false,
        reconnectRequired: true,
        sellerId: connection.seller_id,
      };
    }
  }
}

function isReconnectRequiredError(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const response = error.getResponse();
  if (!isRecord(response)) return false;
  const oauthError = response.mercadoLibreError;
  return (
    response.message === 'Mercado Libre rechazó el intercambio OAuth' &&
    typeof oauthError === 'string' &&
    RECONNECTABLE_OAUTH_ERRORS.has(oauthError)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
