import { ConfigService } from '@nestjs/config';

import { TiendanubeApiService } from './tiendanube-api.service';
import type { TiendanubeEnvironment } from './tiendanube.config';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TiendanubeApiService', () => {
  let service: TiendanubeApiService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: keyof TiendanubeEnvironment) =>
        key === 'TIENDANUBE_USER_AGENT'
          ? 'Panel ML (contact@example.com)'
          : undefined,
      ),
    } as unknown as ConfigService<TiendanubeEnvironment>;

    service = new TiendanubeApiService(configService);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('agrega User-Agent a las solicitudes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 123 }));

    await expect(service.get('1234', '/store')).resolves.toEqual({ id: 123 });

    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);

    expect(url).toBe('https://api.tiendanube.com/2025-03/1234/store');
    expect(headers.get('user-agent')).toBe('Panel ML (contact@example.com)');
    expect(headers.has('authorization')).toBe(false);
  });

  it('agrega Authorization cuando recibe un token y envía JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await service.post(
      1234,
      'resources',
      { name: 'Example' },
      'private-access-token',
    );

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);

    expect(headers.get('authorization')).toBe('Bearer private-access-token');
    expect(headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(init?.body).toBe(JSON.stringify({ name: 'Example' }));
  });

  it('conserva un mensaje útil sin exponer credenciales de Tiendanube', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: 'Unprocessable Entity',
          description: 'Validation error',
          price: ['The price must be a number'],
          debug: 'Bearer private-access-token',
          access_token: 'must-not-leak',
          client_secret: 'must-not-leak',
        },
        422,
      ),
    );

    let caught: unknown;
    try {
      await service.get('1234', 'resource', 'private-access-token');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ status: 422 });
    const serializedError = JSON.stringify(caught);

    expect(serializedError).toContain('Validation error');
    expect(serializedError).toContain('price: The price must be a number');
    expect(serializedError).not.toContain('private-access-token');
    expect(serializedError).not.toContain('must-not-leak');
  });

  it.each([NaN, Infinity, -1, 1.5, 'not-a-store'])(
    'rechaza un storeId inválido sin ejecutar fetch',
    async (storeId) => {
      await expect(service.get(storeId, 'resource')).rejects.toMatchObject({
        status: 400,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
