import { HttpException } from '@nestjs/common';
import {
  MercadolibreApiService,
  sanitizeMercadoLibreData,
} from './mercadolibre-api.service';

/** Crea una respuesta JSON para simular Mercado Libre. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MercadolibreApiService', () => {
  let service: MercadolibreApiService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    service = new MercadolibreApiService();
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('centraliza la URL, autorización y timeout de los GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 123 }));

    await expect(service.get('/users/me', 'private-token')).resolves.toEqual({
      id: 123,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mercadolibre.com/users/me');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer private-token',
    );
    expect(init?.signal).toBeDefined();
  });

  it('acepta timeout positivo por request y rechaza valores inválidos', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 123 }));

    await service.get('/users/me', 'token', undefined, { timeoutMs: 30_000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(
      service.get('/users/me', 'token', undefined, { timeoutMs: 0 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('envía JSON y formularios con su Content-Type correcto', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'private' }));

    await service.post('/items/MLA1', { price: 100 }, 'private-token');
    const form = new URLSearchParams({ grant_type: 'refresh_token' });
    await service.postForm('/oauth/token', form, 'tokenExchange');

    const [, jsonInit] = fetchMock.mock.calls[0];
    expect(jsonInit?.body).toBe(JSON.stringify({ price: 100 }));
    expect(new Headers(jsonInit?.headers).get('content-type')).toBe(
      'application/json',
    );
    const [, formInit] = fetchMock.mock.calls[1];
    expect(formInit?.body).toBe(form);
    expect(new Headers(formInit?.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(new Headers(formInit?.headers).has('authorization')).toBe(false);
  });

  it('sanea los errores OAuth antes de exponerlos', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'invalid_grant',
          message: 'Authorization code expired',
          access_token: 'must-not-leak-access',
          refresh_token: 'must-not-leak-refresh',
          client_secret: 'must-not-leak-secret',
          Authorization: 'Bearer must-not-leak',
        },
        400,
      ),
    );

    let caught: unknown;
    try {
      await service.postForm(
        '/oauth/token',
        new URLSearchParams(),
        'tokenExchange',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual({
      message: 'Mercado Libre rechazó el intercambio OAuth',
      mercadoLibreError: 'invalid_grant',
      mercadoLibreMessage: 'Authorization code expired',
      status: 400,
    });
    expect(JSON.stringify(exception.getResponse())).not.toContain(
      'must-not-leak',
    );
  });

  it('conserva el rechazo sanitizado de una promoción', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: 'invalid deal price',
          error: 'bad_request',
          access_token: 'SECRET',
        },
        400,
      ),
    );

    let caught: unknown;
    try {
      await service.post(
        '/seller-promotions/items/MLA1',
        { price: 100 },
        'private-token',
        'promotion',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getResponse()).toMatchObject({
      mercadoLibreMessage: 'invalid deal price',
      mercadoLibreError: 'bad_request',
    });
    expect(JSON.stringify(exception.getResponse())).not.toContain('SECRET');
  });

  it('conserva el diagnóstico sanitizado de un 5xx de promociones', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: 'provider could not confirm write',
          error: 'internal_error',
          authorization: 'SECRET',
        },
        503,
      ),
    );

    let caught: unknown;
    try {
      await service.post(
        '/seller-promotions/items/MLA1',
        { price: 100 },
        'private-token',
        'promotion',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getResponse()).toMatchObject({
      mercadoLibreMessage: 'provider could not confirm write',
      mercadoLibreError: 'internal_error',
    });
    expect(
      JSON.stringify((caught as HttpException).getResponse()),
    ).not.toContain('SECRET');
  });

  it.each([
    [401, 401],
    [403, 403],
    [429, 503],
    [500, 502],
  ])(
    'mapea un error HTTP %i sin devolver credenciales',
    async (status, ownStatus) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ access_token: 'secret', message: 'upstream' }, status),
      );

      await expect(
        service.get('/items/MLA1', 'private-token'),
      ).rejects.toMatchObject({ status: ownStatus });
    },
  );

  it('distingue un 404 de descripción sin cambiar otros 404', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404));

    await expect(
      service.get('/items/MLA1/description', 'private-token', 'description'),
    ).rejects.toMatchObject({
      status: 404,
      message: 'Mercado Libre no encontró la descripción solicitada',
    });
    await expect(
      service.get('/items/MLA1', 'private-token'),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('distingue timeout, red y JSON inválido', async () => {
    fetchMock
      .mockRejectedValueOnce(
        Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
      )
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }));

    await expect(service.get('/users/me')).rejects.toMatchObject({
      status: 504,
    });
    await expect(service.get('/users/me')).rejects.toMatchObject({
      status: 502,
    });
    await expect(service.get('/users/me')).rejects.toMatchObject({
      status: 502,
    });
  });

  it('sanea campos privados de objetos anidados', () => {
    expect(
      sanitizeMercadoLibreData({
        message: 'safe',
        nested: { refresh_token: 'secret', reason: 'safe-reason' },
      }),
    ).toEqual({ message: 'safe', nested: { reason: 'safe-reason' } });
  });
});
