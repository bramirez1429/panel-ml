import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadolibreService } from './mercadolibre.service';

const configValues: Record<string, string> = {
  ML_CLIENT_ID: 'test-client-id',
  ML_CLIENT_SECRET: 'test-client-secret',
  ML_REDIRECT_URI: 'https://panel-ml.vercel.app/mercadolibre/callback',
  ML_STATE_SECRET: 'test-state-secret-with-at-least-32-bytes',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

function formBody(init?: RequestInit): URLSearchParams {
  if (init?.body instanceof URLSearchParams) {
    return init.body;
  }
  if (typeof init?.body === 'string') {
    return new URLSearchParams(init.body);
  }

  throw new Error('Expected a URL-encoded request body');
}

function detailIds(input: string | URL | Request): string[] {
  return (
    new URL(requestUrl(input)).searchParams
      .get('ids')
      ?.split(',')
      .filter(Boolean) ?? []
  );
}

function safePublication(id: string): Record<string, unknown> {
  return {
    id,
    title: `Publication ${id}`,
    price: 1234.5,
    available_quantity: 7,
    status: 'active',
    seller_id: 123456,
    attributes: [{ id: 'BRAND', value_name: 'Test brand' }],
    shipping: { free_shipping: true, mode: 'me2' },
    seller: { id: 123456, nickname: 'TEST_SELLER' },
    variations: [{ id: `${id}-variation`, stock: 3 }],
  };
}

function upstreamPublication(id: string): Record<string, unknown> {
  const safeBody = safePublication(id);

  return {
    ...safeBody,
    access_token: 'top-level-access-secret',
    refreshToken: 'top-level-refresh-secret',
    client_secret: 'top-level-client-secret',
    Authorization: 'Bearer top-level-secret',
    seller: {
      ...(safeBody.seller as Record<string, unknown>),
      accessToken: 'nested-access-secret',
      refresh_token: 'nested-refresh-secret',
      clientSecret: 'nested-client-secret',
    },
    variations: [
      {
        ...(safeBody.variations as Array<Record<string, unknown>>)[0],
        authorization: 'Bearer nested-array-secret',
      },
    ],
  };
}

function multigetResponse(ids: string[]): Response {
  return jsonResponse(
    ids.map((id) => ({ code: 200, body: upstreamPublication(id) })),
  );
}

describe('MercadolibreService', () => {
  let service: MercadolibreService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    service = new MercadolibreService(configService);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authorization state', () => {
    it('creates the authorization URL with unique verifiable states', () => {
      const firstUrl = new URL(service.createAuthorizationUrl());
      const secondUrl = new URL(service.createAuthorizationUrl());
      const firstState = firstUrl.searchParams.get('state');
      const secondState = secondUrl.searchParams.get('state');

      expect(`${firstUrl.origin}${firstUrl.pathname}`).toBe(
        'https://auth.mercadolibre.com.ar/authorization',
      );
      expect(firstUrl.searchParams.get('response_type')).toBe('code');
      expect(firstUrl.searchParams.get('client_id')).toBe('test-client-id');
      expect(firstUrl.searchParams.get('redirect_uri')).toBe(
        configValues.ML_REDIRECT_URI,
      );
      expect(firstState).toEqual(expect.any(String));
      expect(secondState).toEqual(expect.any(String));
      expect(firstState).not.toBe(secondState);
      expect(service.verifyState(firstState!)).toBe(true);
      expect(service.verifyState(secondState!)).toBe(true);
    });

    it('rejects malformed, tampered and expired states', () => {
      const now = 1_800_000_000_000;
      const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
      const state = new URL(service.createAuthorizationUrl()).searchParams.get(
        'state',
      )!;
      const [nonce, timestamp, signature] = state.split('.');
      const replacement = nonce.startsWith('A') ? 'B' : 'A';
      const tampered = `${replacement}${nonce.slice(1)}.${timestamp}.${signature}`;

      expect(service.verifyState('invalid')).toBe(false);
      expect(service.verifyState(tampered)).toBe(false);
      dateNow.mockReturnValue(now + 10 * 60 * 1000 + 1);
      expect(service.verifyState(state)).toBe(false);
    });
  });

  describe('account API', () => {
    it('exchanges the code as form data and returns the validated tokens', async () => {
      const tokens = {
        access_token: 'access-token-value',
        refresh_token: 'refresh-token-value',
        expires_in: 21_600,
        user_id: 123456,
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(tokens));

      await expect(service.exchangeCode('authorization-code')).resolves.toEqual(
        tokens,
      );

      const [url, init] = fetchMock.mock.calls[0];
      const body = formBody(init);
      expect(requestUrl(url)).toBe('https://api.mercadolibre.com/oauth/token');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('content-type')).toBe(
        'application/x-www-form-urlencoded',
      );
      expect(new Headers(init?.headers).get('accept')).toBe('application/json');
      expect(Object.fromEntries(body)).toEqual({
        grant_type: 'authorization_code',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        code: 'authorization-code',
        redirect_uri: configValues.ML_REDIRECT_URI,
      });
    });

    it('returns a safe OAuth error without exposing credentials', async () => {
      const mercadoLibreMessage =
        'Error validating grant. Your authorization code or redirect URI may be incorrect.';
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'invalid_grant',
            message: mercadoLibreMessage,
            access_token: 'upstream-access-token-must-not-leak',
            refresh_token: 'upstream-refresh-token-must-not-leak',
            client_secret: 'upstream-client-secret-must-not-leak',
            Authorization: 'Bearer upstream-secret-must-not-leak',
          },
          400,
        ),
      );

      expect.assertions(7);
      try {
        await service.exchangeCode('expired-code');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(400);
        const response = (error as HttpException).getResponse();
        expect(response).toEqual({
          message: 'Mercado Libre rechazó el intercambio OAuth',
          mercadoLibreError: 'invalid_grant',
          mercadoLibreMessage,
          status: 400,
        });
        const serialized = JSON.stringify(response);
        expect(serialized).not.toContain('upstream-access-token-must-not-leak');
        expect(serialized).not.toContain(
          'upstream-refresh-token-must-not-leak',
        );
        expect(serialized).not.toContain(
          'upstream-client-secret-must-not-leak',
        );
        expect(serialized).not.toContain(
          'Bearer upstream-secret-must-not-leak',
        );
      }
    });

    it('requests users/me with Bearer auth and projects the seller', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          id: 123456,
          nickname: 'TEST_SELLER',
          email: 'private@example.com',
          access_token: 'must-not-be-returned',
        }),
      );

      await expect(service.getCurrentUser('access-token')).resolves.toEqual({
        id: 123456,
        nickname: 'TEST_SELLER',
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(requestUrl(url)).toBe('https://api.mercadolibre.com/users/me');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer access-token',
      );
    });
  });

  describe('stored account API', () => {
    const connection = {
      seller_id: 123456,
      nickname: 'TEST_SELLER',
      access_token: 'stored-access-token',
      refresh_token: 'stored-refresh-token',
      expires_at: '2030-01-01T00:00:00.000Z',
      updated_at: '2029-12-31T00:00:00.000Z',
    };

    it('refreshes the access token and saves the new tokens', async () => {
      const tokens = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 21_600,
        user_id: connection.seller_id,
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(tokens));
      const saveTokens = jest
        .spyOn(service, 'saveTokens')
        .mockResolvedValue(undefined);

      await expect(service.refreshAccessToken(connection)).resolves.toBe(
        tokens.access_token,
      );
      expect(saveTokens).toHaveBeenCalledWith(
        { id: connection.seller_id, nickname: connection.nickname },
        tokens,
      );
      const [url, init] = fetchMock.mock.calls[0];
      expect(requestUrl(url)).toBe('https://api.mercadolibre.com/oauth/token');
      expect(Object.fromEntries(formBody(init))).toEqual({
        grant_type: 'refresh_token',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        refresh_token: connection.refresh_token,
      });
    });

    it('reuses a valid access token and renews an expired one', async () => {
      const now = 1_800_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      const validConnection = {
        ...connection,
        expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
      };
      const expiredConnection = {
        ...connection,
        expires_at: new Date(now - 1).toISOString(),
      };
      jest
        .spyOn(service, 'getStoredConnection')
        .mockResolvedValueOnce(validConnection)
        .mockResolvedValueOnce(expiredConnection);
      const refreshAccessToken = jest
        .spyOn(service, 'refreshAccessToken')
        .mockResolvedValue('renewed-access-token');

      await expect(service.getValidAccessToken()).resolves.toBe(
        connection.access_token,
      );
      expect(refreshAccessToken).not.toHaveBeenCalled();

      await expect(service.getValidAccessToken()).resolves.toBe(
        'renewed-access-token',
      );
      expect(refreshAccessToken).toHaveBeenCalledWith(expiredConnection);
    });

    it('gets one scan page and its publication details', async () => {
      jest.spyOn(service, 'getStoredConnection').mockResolvedValue(connection);
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            paging: { total: 2 },
            results: ['MLA100', 'MLA200', 'MLA100'],
          }),
        )
        .mockImplementationOnce((input) =>
          Promise.resolve(multigetResponse(detailIds(input))),
        );

      await expect(
        service.getPublicationsPage(25, 'stable-scroll-id'),
      ).resolves.toEqual({
        total: 2,
        count: 2,
        nextScrollId: 'stable-scroll-id',
        finished: false,
        publications: [safePublication('MLA100'), safePublication('MLA200')],
        errors: [],
      });

      const searchUrl = new URL(requestUrl(fetchMock.mock.calls[0][0]));
      expect(searchUrl.pathname).toBe('/users/123456/items/search');
      expect(searchUrl.searchParams.get('search_type')).toBe('scan');
      expect(searchUrl.searchParams.get('limit')).toBe('25');
      expect(searchUrl.searchParams.get('scroll_id')).toBe('stable-scroll-id');
      expect(detailIds(fetchMock.mock.calls[1][0])).toEqual([
        'MLA100',
        'MLA200',
      ]);
    });

    it('finishes a scan even when Mercado Libre omits the total', async () => {
      jest.spyOn(service, 'getStoredConnection').mockResolvedValue(connection);
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock.mockResolvedValueOnce(jsonResponse(null));

      await expect(
        service.getPublicationsPage(50, 'stable-scroll-id'),
      ).resolves.toEqual({
        total: null,
        count: 0,
        nextScrollId: null,
        finished: true,
        publications: [],
        errors: [],
      });
    });

    it('gets one publication with a valid access token', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock.mockResolvedValueOnce(
        jsonResponse(upstreamPublication('MLA100')),
      );

      await expect(service.getPublication('MLA100')).resolves.toEqual(
        safePublication('MLA100'),
      );
      const [url, init] = fetchMock.mock.calls[0];
      expect(requestUrl(url)).toBe('https://api.mercadolibre.com/items/MLA100');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer valid-access-token',
      );
    });

    it('updates a publication price with a valid access token', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ ...upstreamPublication('MLA100'), price: 1500 }),
      );

      await expect(
        service.updatePublicationPrice('MLA100', 1500),
      ).resolves.toEqual({ ...safePublication('MLA100'), price: 1500 });
      const [url, init] = fetchMock.mock.calls[0];
      expect(requestUrl(url)).toBe('https://api.mercadolibre.com/items/MLA100');
      expect(init?.method).toBe('PUT');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer valid-access-token',
      );
      expect(new Headers(init?.headers).get('content-type')).toBe(
        'application/json',
      );
      expect(init?.body).toBe(JSON.stringify({ price: 1500 }));
    });

    it('preserves a safe Mercado Libre price error', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'item.price.not_modifiable',
            message: 'Item has an active price automation',
            access_token: 'must-not-leak',
          },
          400,
        ),
      );

      await expect(
        service.updatePublicationPrice('MLA100', 1500),
      ).rejects.toMatchObject({
        response: {
          error: 'item.price.not_modifiable',
          message: 'Item has an active price automation',
        },
      });
    });
  });
});
