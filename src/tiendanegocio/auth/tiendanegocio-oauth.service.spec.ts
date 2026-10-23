import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { TiendaNegocioConnectionRepository } from '../connections/tiendanegocio-connection.repository';
import { TiendaNegocioOAuthService } from './tiendanegocio-oauth.service';

describe('OAuth de Tienda Negocio', () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const config = {
    get: (key: string) => ({
      TIENDANEGOCIO_APP_ID: '42',
      TIENDANEGOCIO_APP_SECRET: 'private-value',
      TIENDANEGOCIO_APP_HANDLE: 'saelecommerce',
    })[key as 'TIENDANEGOCIO_APP_ID' | 'TIENDANEGOCIO_APP_SECRET' | 'TIENDANEGOCIO_APP_HANDLE'],
  } as unknown as ConfigService;
  const service = new TiendaNegocioOAuthService(
    config,
    { save } as unknown as TiendaNegocioConnectionRepository,
  );
  const originalFetch = globalThis.fetch;

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('guarda el token y client_id que representa la tienda', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'token-example-12345', client_id: 789, scope: 'write_products' }),
      { status: 200 },
    ));
    await expect(service.exchange('user-1', 'valid-code')).resolves.toEqual({ storeId: '789' });
    expect(save).toHaveBeenCalledWith({
      user_id: 'user-1', store_id: '789', access_token: 'token-example-12345', scope: 'write_products',
    });
  });

  it('prueba ruta alternativa solo si la primera devuelve 404', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ access_token: 'token-example-12345', client_id: 789 }),
        { status: 200 },
      ));
    globalThis.fetch = fetchMock;
    await expect(service.exchange('user-1', 'valid-code')).resolves.toEqual({ storeId: '789' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('api.tiendanegocio.com');
  });

  it('no reintenta un código rechazado o vencido', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 401 }));
    globalThis.fetch = fetchMock;
    await expect(service.exchange('user-1', 'invalid-code'))
      .rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([400, 422])('clasifica %i como código inválido, vencido o consumido', async (status) => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(null, { status }));
    await expect(service.exchange('user-1', 'single-use-code')).rejects.toBeInstanceOf(BadRequestException);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500, 502, 503])('clasifica %i como fallo del proveedor o de credenciales', async (status) => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(null, { status }));
    await expect(service.exchange('user-1', 'single-use-code')).rejects.toBeInstanceOf(BadGatewayException);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('no persiste si la respuesta exitosa no tiene JSON válido', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response('not-json', { status: 200 }));
    await expect(service.exchange('user-1', 'single-use-code')).rejects.toBeInstanceOf(BadGatewayException);
    expect(save).not.toHaveBeenCalled();
  });

  it('mantiene el 503 de Supabase si persiste el token falla', async () => {
    const failing = new ServiceUnavailableException('persistencia no disponible');
    const repository = { save: jest.fn().mockRejectedValue(failing) } as unknown as TiendaNegocioConnectionRepository;
    const failingService = new TiendaNegocioOAuthService(config, repository);
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ access_token: 'token-example-12345', client_id: 789 }),
      { status: 200 },
    ));
    await expect(failingService.exchange('user-1', 'single-use-code')).rejects.toBe(failing);
  });
});
