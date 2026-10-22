import { BadGatewayException } from '@nestjs/common';
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
});
