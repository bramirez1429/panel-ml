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

  describe('getPublications', () => {
    it('lists the first 20 ids, uses multiget and returns only public fields', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            paging: { total: 34, offset: 0, limit: 20 },
            results: ['MLA100', 'MLA200'],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse([
            {
              code: 200,
              body: {
                id: 'MLA100',
                title: 'First publication',
                price: 1200,
                available_quantity: 4,
                status: 'active',
                permalink: 'https://articulo.mercadolibre.com.ar/MLA100',
                thumbnail: 'https://http2.mlstatic.com/MLA100.jpg',
                seller_id: 123456,
              },
            },
            {
              code: 200,
              body: {
                id: 'MLA200',
                title: 'Second publication',
                price: 2300.5,
                available_quantity: 0,
                status: 'paused',
                permalink: 'https://articulo.mercadolibre.com.ar/MLA200',
                thumbnail: 'https://http2.mlstatic.com/MLA200.jpg',
                secure_thumbnail: 'private-extra-field',
              },
            },
          ]),
        );

      const result = await service.getPublications(123456, 'access-token');

      expect(result).toEqual({
        total: 34,
        publications: [
          {
            id: 'MLA100',
            title: 'First publication',
            price: 1200,
            available_quantity: 4,
            status: 'active',
            permalink: 'https://articulo.mercadolibre.com.ar/MLA100',
            thumbnail: 'https://http2.mlstatic.com/MLA100.jpg',
          },
          {
            id: 'MLA200',
            title: 'Second publication',
            price: 2300.5,
            available_quantity: 0,
            status: 'paused',
            permalink: 'https://articulo.mercadolibre.com.ar/MLA200',
            thumbnail: 'https://http2.mlstatic.com/MLA200.jpg',
          },
        ],
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [searchUrl, searchInit] = fetchMock.mock.calls[0];
      const parsedSearchUrl = new URL(requestUrl(searchUrl));
      expect(parsedSearchUrl.pathname).toBe('/users/123456/items/search');
      expect(parsedSearchUrl.searchParams.get('limit')).toBe('20');
      expect(parsedSearchUrl.searchParams.get('offset')).toBe('0');
      expect(new Headers(searchInit?.headers).get('authorization')).toBe(
        'Bearer access-token',
      );

      const [detailsUrl, detailsInit] = fetchMock.mock.calls[1];
      const parsedDetailsUrl = new URL(requestUrl(detailsUrl));
      expect(parsedDetailsUrl.pathname).toBe('/items');
      expect(parsedDetailsUrl.searchParams.get('ids')).toBe('MLA100,MLA200');
      expect(new Headers(detailsInit?.headers).get('authorization')).toBe(
        'Bearer access-token',
      );
      expect(Object.keys(result.publications[0]).sort()).toEqual(
        [
          'id',
          'title',
          'price',
          'available_quantity',
          'status',
          'permalink',
          'thumbnail',
        ].sort(),
      );
    });

    it('does not call multiget when the seller has no publications', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ paging: { total: 0 }, results: [] }),
      );

      await expect(
        service.getPublications(123456, 'access-token'),
      ).resolves.toEqual({ total: 0, publications: [] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('translates Mercado Libre search errors', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ message: 'failure' }, 500),
      );

      await expect(
        service.getPublications(123456, 'access-token'),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('rejects a multiget with no valid publication details', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ paging: { total: 1 }, results: ['MLA100'] }),
        )
        .mockResolvedValueOnce(
          jsonResponse([{ code: 404, body: { message: 'not found' } }]),
        );

      await expect(
        service.getPublications(123456, 'access-token'),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
