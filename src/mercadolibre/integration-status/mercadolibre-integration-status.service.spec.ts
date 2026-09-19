import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MercadoLibreConnection } from '../../database/supabase.service';
import { MercadolibreIntegrationStatusService } from './mercadolibre-integration-status.service';

const connection: MercadoLibreConnection = {
  user_id: 'owner',
  seller_id: 639189394,
  nickname: 'SELLER',
  access_token: 'access',
  refresh_token: 'refresh',
  expires_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function setup(connected = true) {
  const tokenService = {
    getConnectionStatus: jest
      .fn()
      .mockResolvedValue(
        connected
          ? { connected: true, sellerId: connection.seller_id }
          : { connected: false },
      ),
    getSharedStoredConnection: jest.fn().mockResolvedValue(connection),
    getSharedValidAccessToken: jest.fn().mockResolvedValue('valid-token'),
  };
  return {
    service: new MercadolibreIntegrationStatusService(tokenService as never),
    tokenService,
  };
}

describe('MercadolibreIntegrationStatusService', () => {
  it('devuelve connected cuando la infraestructura obtiene un token válido', async () => {
    const { service, tokenService } = setup();
    await expect(service.getStatus('panel-user')).resolves.toEqual({
      connected: true,
      reconnectRequired: false,
      sellerId: 639189394,
    });
    expect(tokenService.getSharedValidAccessToken).toHaveBeenCalledWith(connection);
  });

  it('devuelve reconnectRequired ante un rechazo OAuth conocido', async () => {
    const { service, tokenService } = setup();
    tokenService.getSharedValidAccessToken.mockRejectedValue(
      new BadRequestException({
        message: 'Mercado Libre rechazó el intercambio OAuth',
        mercadoLibreError: 'invalid_grant',
        status: 400,
      }),
    );
    await expect(service.getStatus('panel-user')).resolves.toEqual({
      connected: false,
      reconnectRequired: true,
      sellerId: 639189394,
    });
  });

  it('devuelve not-connected cuando no existe una conexión guardada', async () => {
    const { service, tokenService } = setup(false);
    await expect(service.getStatus('panel-user')).resolves.toEqual({
      connected: false,
      reconnectRequired: false,
    });
    expect(tokenService.getSharedStoredConnection).not.toHaveBeenCalled();
    expect(tokenService.getSharedValidAccessToken).not.toHaveBeenCalled();
  });

  it('propaga errores inesperados para que el consumidor informe unknown', async () => {
    const { service, tokenService } = setup();
    const unexpected = new ServiceUnavailableException(
      'Mercado Libre no está disponible',
    );
    tokenService.getSharedValidAccessToken.mockRejectedValue(unexpected);
    await expect(service.getStatus('panel-user')).rejects.toBe(unexpected);
  });
});
