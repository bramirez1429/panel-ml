import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadolibreService } from './mercadolibre.service';

const configValues: Record<string, string> = {
  ML_CLIENT_ID: 'test-client-id',
  ML_CLIENT_SECRET: 'test-client-secret',
  ML_REDIRECT_URI: 'https://panel-ml.vercel.app/mercadolibre/callback',
  ML_STATE_SECRET: 'test-state-secret-with-at-least-32-bytes',
};

const sensitiveKeys = new Set([
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'authorization',
]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectNoSensitiveKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectNoSensitiveKeys);
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key
      .toLowerCase()
      .replaceAll('_', '')
      .replaceAll('-', '');
    expect(sensitiveKeys.has(normalizedKey)).toBe(false);
    expectNoSensitiveKeys(nestedValue);
  }
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
    it('exchanges the code as form data and returns only the access token', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token-value',
          refresh_token: 'refresh-token-value',
        }),
      );

      await expect(service.exchangeCode('authorization-code')).resolves.toBe(
        'access-token-value',
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

    it('rejects an invalid code without exposing the upstream body', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'invalid_grant',
            message: 'upstream-message-must-not-leak',
            access_token: 'upstream-access-token-must-not-leak',
          },
          400,
        ),
      );

      expect.assertions(4);
      try {
        await service.exchangeCode('expired-code');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(400);
        expect((error as Error).message).toBe(
          'El código de autorización fue rechazado o venció',
        );
        expect(
          JSON.stringify((error as HttpException).getResponse()),
        ).not.toContain('upstream-access-token-must-not-leak');
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

  describe('getAllPublications', () => {
    it('reuses the initial scan cursor, deduplicates ids and keeps the first total', async () => {
      const pages: unknown[] = [
        {
          paging: { total: 10 },
          scroll_id: 'stable-scroll-id',
          results: ['MLA001', 'MLA002'],
        },
        { paging: { total: 999 }, results: ['MLA002', 'MLA003'] },
        { results: null },
      ];
      let scanCall = 0;

      fetchMock.mockImplementation((input, init) => {
        const url = new URL(requestUrl(input));
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer access-token',
        );
        if (url.pathname.endsWith('/items/search')) {
          const page = pages[scanCall];
          scanCall += 1;
          return Promise.resolve(jsonResponse(page));
        }

        return Promise.resolve(multigetResponse(detailIds(input)));
      });

      const result = await service.getAllPublications(123456, 'access-token');
      const scanUrls = fetchMock.mock.calls
        .map(([input]) => new URL(requestUrl(input)))
        .filter(({ pathname }) => pathname.endsWith('/items/search'));

      expect(result).toEqual({
        totalReported: 10,
        idsRetrieved: 3,
        publicationsRetrieved: 3,
        failed: 0,
        publications: [
          safePublication('MLA001'),
          safePublication('MLA002'),
          safePublication('MLA003'),
        ],
        errors: [],
      });
      expect(scanUrls.map((url) => url.searchParams.get('scroll_id'))).toEqual([
        null,
        'stable-scroll-id',
        'stable-scroll-id',
      ]);
      for (const url of scanUrls) {
        expect(url.searchParams.get('search_type')).toBe('scan');
        expect(url.searchParams.get('limit')).toBe('100');
      }
    });

    it('chunks details, limits concurrency, sanitizes bodies and collects item errors', async () => {
      const ids = Array.from(
        { length: 85 },
        (_, index) => `MLA${String(index + 1).padStart(3, '0')}`,
      );
      const notFoundBody = { error: 'not_found', message: 'Item not found' };
      let inFlight = 0;
      let maxInFlight = 0;

      fetchMock.mockImplementation((input) => {
        const url = new URL(requestUrl(input));
        if (url.pathname.endsWith('/items/search')) {
          return Promise.resolve(
            url.searchParams.has('scroll_id')
              ? jsonResponse({ results: [] })
              : jsonResponse({
                  scroll_id: 'stable-scroll-id',
                  results: ids,
                }),
          );
        }

        const batchIds = detailIds(input);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return Promise.resolve().then(() => {
          inFlight -= 1;
          return jsonResponse(
            batchIds.map((id) =>
              id === 'MLA023'
                ? { code: 404, body: notFoundBody }
                : { code: 200, body: upstreamPublication(id) },
            ),
          );
        });
      });

      const result = await service.getAllPublications(123456, 'access-token');
      const detailCalls = fetchMock.mock.calls.filter(
        ([input]) => new URL(requestUrl(input)).pathname === '/items',
      );
      const chunks = detailCalls.map(([input]) => detailIds(input));

      expect(chunks.map(({ length }) => length).sort((a, b) => b - a)).toEqual([
        20, 20, 20, 20, 5,
      ]);
      expect(new Set(chunks.flat())).toEqual(new Set(ids));
      expect(maxInFlight).toBeGreaterThan(1);
      expect(maxInFlight).toBeLessThanOrEqual(4);
      expect(result).toMatchObject({
        totalReported: 85,
        idsRetrieved: 85,
        publicationsRetrieved: 84,
        failed: 1,
        errors: [{ id: 'MLA023', code: 404, body: notFoundBody }],
      });
      expect(result.publications).toHaveLength(84);
      expect(result.publications).toContainEqual(safePublication('MLA001'));
      expectNoSensitiveKeys(result.publications);
    });

    it('keeps successful batches and creates one error per failed id', async () => {
      const ids = Array.from(
        { length: 41 },
        (_, index) => `MLA${String(index + 1).padStart(3, '0')}`,
      );

      fetchMock.mockImplementation((input) => {
        const url = new URL(requestUrl(input));
        if (url.pathname.endsWith('/items/search')) {
          return Promise.resolve(
            url.searchParams.has('scroll_id')
              ? jsonResponse({ results: [] })
              : jsonResponse({
                  paging: { total: ids.length },
                  scroll_id: 'stable-scroll-id',
                  results: ids,
                }),
          );
        }

        const batchIds = detailIds(input);
        return batchIds[0] === 'MLA021'
          ? Promise.reject(new Error('simulated network failure'))
          : Promise.resolve(multigetResponse(batchIds));
      });

      const result = await service.getAllPublications(123456, 'access-token');

      expect(result).toMatchObject({
        totalReported: 41,
        idsRetrieved: 41,
        publicationsRetrieved: 21,
        failed: 20,
      });
      expect(result.publications).toEqual([
        ...ids.slice(0, 20).map(safePublication),
        safePublication('MLA041'),
      ]);
      expect(result.errors.map(({ id }) => id)).toEqual(ids.slice(20, 40));
      for (const error of result.errors) {
        expect(Number.isInteger(error.code)).toBe(true);
        expect(error).toHaveProperty('body');
      }
      expectNoSensitiveKeys(result);
    });
  });
});
