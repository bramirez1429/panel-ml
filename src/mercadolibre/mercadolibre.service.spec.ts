import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
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

function fullPublicationBody(id: string): Record<string, unknown> {
  return {
    id,
    title: `Publication ${id}`,
    price: 1234.5,
    available_quantity: 7,
    status: 'active',
    permalink: `https://articulo.mercadolibre.com.ar/${id}`,
    thumbnail: `https://http2.mlstatic.com/${id}.jpg`,
    seller_id: 123456,
    attributes: [{ id: 'BRAND', value_name: 'Test brand' }],
    shipping: { free_shipping: true, mode: 'me2' },
    seller: { id: 123456, nickname: 'TEST_SELLER' },
    variations: [
      {
        id: `${id}-variation`,
        attribute_combinations: [{ id: 'COLOR', value_name: 'Black' }],
      },
    ],
  };
}

function upstreamPublicationBody(id: string): Record<string, unknown> {
  const safeBody = fullPublicationBody(id);

  return {
    ...safeBody,
    access_token: 'top-level-access-secret',
    refreshToken: 'top-level-refresh-secret',
    client_secret: 'top-level-client-secret',
    Authorization: 'Bearer top-level-authorization-secret',
    seller: {
      ...(safeBody.seller as Record<string, unknown>),
      accessToken: 'nested-access-secret',
      refresh_token: 'nested-refresh-secret',
      clientSecret: 'nested-client-secret',
      authorization: 'Bearer nested-authorization-secret',
    },
    variations: [
      {
        ...(safeBody.variations as Array<Record<string, unknown>>)[0],
        access_token: 'array-access-secret',
        Authorization: 'Bearer array-authorization-secret',
      },
    ],
  };
}

function multigetResponse(ids: string[]): Response {
  return jsonResponse(
    ids.map((id) => ({ code: 200, body: upstreamPublicationBody(id) })),
  );
}

function detailIds(input: string | URL | Request): string[] {
  const url = new URL(requestUrl(input));
  return url.searchParams.get('ids')?.split(',').filter(Boolean) ?? [];
}

describe('MercadolibreService', () => {
  let service: MercadolibreService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MercadolibreService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
          },
        },
      ],
    }).compile();

    service = module.get<MercadolibreService>(MercadolibreService);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('createAuthorizationUrl and verifyState', () => {
    it('creates a Mercado Libre authorization URL with a unique valid state', () => {
      const firstUrl = new URL(service.createAuthorizationUrl());
      const secondUrl = new URL(service.createAuthorizationUrl());
      const firstState = firstUrl.searchParams.get('state');
      const secondState = secondUrl.searchParams.get('state');

      expect(firstUrl.origin).toBe('https://auth.mercadolibre.com.ar');
      expect(firstUrl.pathname).toBe('/authorization');
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

    it('rejects a tampered state', () => {
      const state = new URL(service.createAuthorizationUrl()).searchParams.get(
        'state',
      )!;
      const index = Math.floor(state.length / 2);
      const replacement = state[index] === 'a' ? 'b' : 'a';
      const tampered = `${state.slice(0, index)}${replacement}${state.slice(
        index + 1,
      )}`;

      expect(service.verifyState(tampered)).toBe(false);
    });

    it('rejects a state older than ten minutes', () => {
      const now = 1_800_000_000_000;
      const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
      const state = new URL(service.createAuthorizationUrl()).searchParams.get(
        'state',
      )!;

      dateNow.mockReturnValue(now + 10 * 60 * 1000 + 1);

      expect(service.verifyState(state)).toBe(false);
    });

    it.each(['', 'invalid', 'part.one.two.three'])(
      'rejects malformed state %p',
      (state) => {
        expect(service.verifyState(state)).toBe(false);
      },
    );
  });

  describe('exchangeCode', () => {
    it('exchanges the code as form data and returns only the access token', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token-value',
          refresh_token: 'refresh-token-value',
          token_type: 'bearer',
        }),
      );

      await expect(service.exchangeCode('authorization-code')).resolves.toBe(
        'access-token-value',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      const headers = new Headers(init?.headers);
      const body = formBody(init);

      expect(requestUrl(url)).toBe('https://api.mercadolibre.com/oauth/token');
      expect(init?.method).toBe('POST');
      expect(headers.get('content-type')).toBe(
        'application/x-www-form-urlencoded',
      );
      expect(Object.fromEntries(body)).toEqual({
        grant_type: 'authorization_code',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        code: 'authorization-code',
        redirect_uri: configValues.ML_REDIRECT_URI,
      });
    });

    it('translates a rejected token request without exposing response secrets', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            message: 'invalid grant',
            access_token: 'upstream-token-must-not-leak',
          },
          400,
        ),
      );

      expect.assertions(2);
      try {
        await service.exchangeCode('expired-code');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as Error).message).not.toContain(
          'upstream-token-must-not-leak',
        );
      }
    });
  });

  describe('getCurrentUser', () => {
    it('requests users/me with Bearer authentication and filters the seller', async () => {
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
    it('scans every page, deduplicates ids and stops on null results', async () => {
      const pages: unknown[] = [
        {
          paging: { total: 10 },
          scroll_id: 'stable-scroll-id',
          results: ['MLA001', 'MLA002'],
        },
        {
          paging: { total: 999 },
          results: ['MLA002', 'MLA003'],
        },
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

      expect(result).toEqual({
        totalReported: 10,
        idsRetrieved: 3,
        publicationsRetrieved: 3,
        failed: 0,
        publications: [
          fullPublicationBody('MLA001'),
          fullPublicationBody('MLA002'),
          fullPublicationBody('MLA003'),
        ],
        errors: [],
      });
      expect(JSON.stringify(result.publications)).not.toContain('secret');

      const searchCalls = fetchMock.mock.calls.filter(([input]) =>
        requestUrl(input).includes('/items/search'),
      );
      expect(searchCalls).toHaveLength(3);
      expect(
        searchCalls.map(([input]) => {
          const url = new URL(requestUrl(input));
          return {
            searchType: url.searchParams.get('search_type'),
            limit: url.searchParams.get('limit'),
            scrollId: url.searchParams.get('scroll_id'),
          };
        }),
      ).toEqual([
        { searchType: 'scan', limit: '100', scrollId: null },
        { searchType: 'scan', limit: '100', scrollId: 'stable-scroll-id' },
        { searchType: 'scan', limit: '100', scrollId: 'stable-scroll-id' },
      ]);
    });

    it('retrieves 1,418 ids without a total cap', async () => {
      const ids = Array.from(
        { length: 1_418 },
        (_, index) => `MLA${String(index + 1).padStart(4, '0')}`,
      );
      const pages: string[][] = [];
      for (let index = 0; index < ids.length; index += 100) {
        pages.push(ids.slice(index, index + 100));
      }
      let scanPageIndex = 0;

      fetchMock.mockImplementation((input) => {
        const url = new URL(requestUrl(input));
        if (url.pathname.endsWith('/items/search')) {
          const results = pages[scanPageIndex] ?? [];
          const isFirstPage = scanPageIndex === 0;
          scanPageIndex += 1;
          return Promise.resolve(
            jsonResponse({
              ...(isFirstPage
                ? {
                    paging: { total: ids.length },
                    scroll_id: 'stable-scroll-id',
                  }
                : {}),
              results,
            }),
          );
        }

        return Promise.resolve(multigetResponse(detailIds(input)));
      });

      const result = await service.getAllPublications(123456, 'access-token');
      const searchCalls = fetchMock.mock.calls.filter(([input]) =>
        requestUrl(input).includes('/items/search'),
      );
      const detailCalls = fetchMock.mock.calls.filter(
        ([input]) => new URL(requestUrl(input)).pathname === '/items',
      );

      expect(result).toMatchObject({
        totalReported: 1_418,
        idsRetrieved: 1_418,
        publicationsRetrieved: 1_418,
        failed: 0,
        errors: [],
      });
      expect(result.publications).toHaveLength(1_418);
      expect(searchCalls).toHaveLength(16);
      expect(detailCalls).toHaveLength(71);
    });

    it('falls back to unique ids, chunks by 20 and sanitizes only sensitive body keys', async () => {
      const uniqueIds = Array.from(
        { length: 45 },
        (_, index) => `MLA${String(index + 1).padStart(3, '0')}`,
      );
      const duplicatedResults = [
        ...uniqueIds.slice(0, 30),
        uniqueIds[4],
        uniqueIds[12],
        ...uniqueIds.slice(30),
      ];
      const notFoundBody = {
        error: 'not_found',
        message: 'Item MLA023 was not found',
      };

      fetchMock.mockImplementation((input) => {
        const url = new URL(requestUrl(input));
        if (url.pathname.endsWith('/items/search')) {
          return Promise.resolve(
            url.searchParams.has('scroll_id')
              ? jsonResponse({ results: [] })
              : jsonResponse({
                  scroll_id: 'terminal-scroll',
                  results: duplicatedResults,
                }),
          );
        }

        const ids = detailIds(input);
        return Promise.resolve(
          jsonResponse(
            ids.map((id) =>
              id === 'MLA023'
                ? { code: 404, body: notFoundBody }
                : { code: 200, body: upstreamPublicationBody(id) },
            ),
          ),
        );
      });

      const result = await service.getAllPublications(123456, 'access-token');
      const detailCalls = fetchMock.mock.calls.filter(
        ([input]) => new URL(requestUrl(input)).pathname === '/items',
      );
      const requestedChunks = detailCalls.map(([input]) => detailIds(input));

      expect(
        requestedChunks.map((ids) => ids.length).sort((a, b) => b - a),
      ).toEqual([20, 20, 5]);
      expect(new Set(requestedChunks.flat())).toEqual(new Set(uniqueIds));
      expect(requestedChunks.flat()).toHaveLength(45);
      expect(result).toMatchObject({
        totalReported: 45,
        idsRetrieved: 45,
        publicationsRetrieved: 44,
        failed: 1,
        errors: [{ id: 'MLA023', code: 404, body: notFoundBody }],
      });
      expect(result.publications).toHaveLength(44);
      expect(result.publications).toContainEqual(fullPublicationBody('MLA001'));
      expect(JSON.stringify(result.publications)).not.toContain('secret');
    });

    it('never runs more than four multiget batches concurrently', async () => {
      const ids = Array.from(
        { length: 101 },
        (_, index) => `MLA${String(index + 1).padStart(3, '0')}`,
      );
      let inFlight = 0;
      let maxInFlight = 0;

      fetchMock.mockImplementation((input) => {
        const url = new URL(requestUrl(input));
        if (url.pathname.endsWith('/items/search')) {
          return Promise.resolve(
            url.searchParams.has('scroll_id')
              ? jsonResponse({ results: [] })
              : jsonResponse({
                  paging: { total: ids.length },
                  scroll_id: 'terminal-scroll',
                  results: ids,
                }),
          );
        }

        const batchIds = detailIds(input);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            inFlight -= 1;
            resolve(multigetResponse(batchIds));
          }, 5);
        });
      });

      const result = await service.getAllPublications(123456, 'access-token');

      expect(maxInFlight).toBeLessThanOrEqual(4);
      expect(maxInFlight).toBeGreaterThan(1);
      expect(result).toMatchObject({
        totalReported: 101,
        idsRetrieved: 101,
        publicationsRetrieved: 101,
        failed: 0,
      });
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => new URL(requestUrl(input)).pathname === '/items',
        ),
      ).toHaveLength(6);
    });

    it('keeps successful batches and creates one error per id for batch failures', async () => {
      const ids = Array.from(
        { length: 62 },
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
                  scroll_id: 'terminal-scroll',
                  results: ids,
                }),
          );
        }

        const batchIds = detailIds(input);
        if (batchIds[0] === 'MLA021') {
          return Promise.reject(new Error('simulated network failure'));
        }
        if (batchIds[0] === 'MLA041') {
          return Promise.resolve(
            jsonResponse(
              {
                message: 'upstream unavailable',
                access_token: 'must-not-leak',
              },
              503,
            ),
          );
        }
        if (batchIds[0] === 'MLA061') {
          return Promise.resolve(
            new Response('not valid JSON', { status: 200 }),
          );
        }

        return Promise.resolve(multigetResponse(batchIds));
      });

      const result = await service.getAllPublications(123456, 'access-token');

      expect(result.totalReported).toBe(62);
      expect(result.idsRetrieved).toBe(62);
      expect(result.publicationsRetrieved).toBe(20);
      expect(result.publications).toEqual(
        ids.slice(0, 20).map(fullPublicationBody),
      );
      expect(result.failed).toBe(42);
      expect(result.errors).toHaveLength(42);
      expect(JSON.stringify(result)).not.toContain('must-not-leak');
      expect(new Set(result.errors.map(({ id }) => id))).toEqual(
        new Set(ids.slice(20)),
      );
      for (const error of result.errors) {
        expect(Number.isInteger(error.code)).toBe(true);
        expect(error).toHaveProperty('body');
      }
    });

    it('deduplicates a repeated page and continues until results is empty', async () => {
      const repeatedPage = ['MLA001', 'MLA002'];
      let searchCall = 0;

      fetchMock.mockImplementation((input) => {
        const url = new URL(requestUrl(input));
        if (url.pathname.endsWith('/items/search')) {
          searchCall += 1;
          if (searchCall === 1) {
            return Promise.resolve(
              jsonResponse({
                paging: { total: 2 },
                scroll_id: 'stable-scroll-id',
                results: repeatedPage,
              }),
            );
          }

          return Promise.resolve(
            jsonResponse({
              results: searchCall === 2 ? repeatedPage : [],
            }),
          );
        }

        return Promise.resolve(multigetResponse(detailIds(input)));
      });

      const result = await service.getAllPublications(123456, 'access-token');

      expect(result).toMatchObject({
        totalReported: 2,
        idsRetrieved: 2,
        publicationsRetrieved: 2,
        failed: 0,
      });
      expect(searchCall).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it.each([401, 403, 429, 500])(
      'handles a scan HTTP %i response',
      async (status) => {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ message: 'upstream error' }, status),
        );

        await expect(
          service.getAllPublications(123456, 'access-token'),
        ).rejects.toBeInstanceOf(HttpException);
      },
    );

    it('rejects invalid JSON from a scan page', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('not valid JSON', { status: 200 }),
      );

      await expect(
        service.getAllPublications(123456, 'access-token'),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('fails fast when the initial non-empty scan page has no scroll id', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          paging: { total: 2 },
          results: ['MLA001', 'MLA002'],
        }),
      );

      await expect(
        service.getAllPublications(123456, 'access-token'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails fast when a scroll id expires before the terminal page', async () => {
      fetchMock.mockImplementation((input) => {
        const url = new URL(requestUrl(input));
        return Promise.resolve(
          url.searchParams.has('scroll_id')
            ? jsonResponse(
                { error: 'bad_request', message: 'expired scroll_id' },
                400,
              )
            : jsonResponse({
                paging: { total: 1 },
                scroll_id: 'expired-scroll',
                results: ['MLA001'],
              }),
        );
      });

      await expect(
        service.getAllPublications(123456, 'access-token'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.some(
          ([input]) => new URL(requestUrl(input)).pathname === '/items',
        ),
      ).toBe(false);
    });
  });
});
