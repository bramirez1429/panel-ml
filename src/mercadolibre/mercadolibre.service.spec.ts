import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadolibreService } from './mercadolibre.service';

const configValues: Record<string, string> = {
  ML_CLIENT_ID: 'test-client-id',
  ML_CLIENT_SECRET: 'test-client-secret',
  ML_REDIRECT_URI: 'https://panel-ml.vercel.app/mercadolibre/callback',
  ML_STATE_SECRET: 'test-state-secret-with-at-least-32-bytes',
};

const PRICED_ITEM_ID = 'MLA3042295334';
const USER_PRODUCT_ID = 'MLAU123456789';
const PROMOTION_START_DATE = '2026-08-04T00:00:00Z';
const PROMOTION_FINISH_DATE = '2026-08-17T23:59:59Z';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status = 200): Response {
  return new Response(null, { status });
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

function jsonBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected a JSON request body');
  }
  return JSON.parse(init.body) as unknown;
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

function pricedItem() {
  return {
    id: PRICED_ITEM_ID,
    title: 'Publicación con promoción',
    status: 'active',
    currency_id: 'ARS',
    price: 24_750,
    base_price: 24_750,
    original_price: 27_000,
  };
}

function pricesResponse(marketplaceAmount = 40_000) {
  return {
    id: PRICED_ITEM_ID,
    prices: [
      {
        type: 'standard',
        amount: 24_750,
        currency_id: 'ARS',
        conditions: { context_restrictions: [] },
      },
      {
        type: 'standard',
        amount: marketplaceAmount,
        currency_id: 'ARS',
        conditions: { context_restrictions: ['channel_marketplace'] },
      },
      {
        type: 'promotion',
        amount: 24_750,
        regular_amount: 27_000,
        currency_id: 'ARS',
        conditions: { context_restrictions: ['channel_marketplace'] },
      },
    ],
  };
}

function salePriceResponse() {
  return {
    amount: 24_750,
    regular_amount: 27_000,
    currency_id: 'ARS',
  };
}

function finalSalePriceResponse() {
  return {
    amount: 30_000,
    regular_amount: 40_000,
    currency_id: 'ARS',
  };
}

function pricingInput(confirmPromotionReplace = true) {
  return {
    listPrice: 40_000,
    salePrice: 30_000,
    startDate: PROMOTION_START_DATE,
    finishDate: PROMOTION_FINISH_DATE,
    confirmPromotionReplace,
  };
}

function dealPricingInput() {
  return {
    listPrice: 40_000,
    salePrice: 30_000,
  };
}

function replaceDealInput(confirmReplaceDeal = true) {
  return {
    listPrice: 40_000,
    salePrice: 30_000,
    startDate: PROMOTION_START_DATE,
    finishDate: PROMOTION_FINISH_DATE,
    confirmReplaceDeal,
  };
}

function promotionResponse(
  type = 'PRICE_DISCOUNT',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'OFFER-MLA3042295334-OLD',
    type,
    status: 'started',
    price: 24_750,
    original_price: 27_000,
    start_date: '2026-07-01T00:00:00Z',
    finish_date: '2026-08-03T23:59:59Z',
    name: 'Promoción anterior',
    ...overrides,
  };
}

function expectedPromotion(
  type = 'PRICE_DISCOUNT',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'OFFER-MLA3042295334-OLD',
    type,
    status: 'started',
    price: 24_750,
    originalPrice: 27_000,
    startDate: '2026-07-01T00:00:00Z',
    finishDate: '2026-08-03T23:59:59Z',
    ...overrides,
  };
}

function dealPromotionResponse(overrides: Record<string, unknown> = {}) {
  return promotionResponse('DEAL', {
    id: 'P-MLA17845002',
    status: 'pending',
    price: 24_750,
    original_price: 40_000,
    name: 'DIA DEL NINO 2026',
    ...overrides,
  });
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

    it('gets one publication with its current and legacy pricing', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse(salePriceResponse()));

      const result = await service.getPublication(PRICED_ITEM_ID);

      expect(result).toEqual({
        id: PRICED_ITEM_ID,
        title: 'Publicación con promoción',
        status: 'active',
        currency_id: 'ARS',
        pricing: {
          listPrice: 40_000,
          salePrice: 24_750,
          promotionRegularPrice: 27_000,
          currencyId: 'ARS',
          hasPromotion: true,
        },
        legacyPricing: {
          price: 24_750,
          basePrice: 24_750,
          originalPrice: 27_000,
        },
      });
      expect(result).not.toHaveProperty('price');
      expect(result).not.toHaveProperty('base_price');
      expect(result).not.toHaveProperty('original_price');
      expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
        `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
        `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/prices`,
        `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/sale_price?context=channel_marketplace`,
      ]);
      const [, init] = fetchMock.mock.calls[0];
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer valid-access-token',
      );
      const [, pricesInit] = fetchMock.mock.calls[1];
      expect(new Headers(pricesInit?.headers).get('authorization')).toBe(
        'Bearer valid-access-token',
      );
      expect(new Headers(pricesInit?.headers).get('content-type')).toBe(
        'application/json',
      );
    });

    it('updates the list price and returns the active promotion', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse(salePriceResponse()));

      await expect(
        service.updatePublicationPrice(PRICED_ITEM_ID, 40_000),
      ).resolves.toEqual({
        ok: true,
        itemId: PRICED_ITEM_ID,
        requestedPrice: 40_000,
        listPriceAfterUpdate: 40_000,
        salePriceAfterUpdate: 24_750,
        promotionRegularPrice: 27_000,
        hasPromotion: true,
      });

      expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
        `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
        `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/prices`,
        `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/sale_price?context=channel_marketplace`,
      ]);
      const [, init] = fetchMock.mock.calls[0];
      expect(init?.method).toBe('PUT');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer valid-access-token',
      );
      expect(new Headers(init?.headers).get('content-type')).toBe(
        'application/json',
      );
      expect(init?.body).toBe(JSON.stringify({ price: 40_000 }));
    });

    it('warns only when the standard price differs from the requested price', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
        .mockResolvedValueOnce(jsonResponse(pricesResponse(39_999)))
        .mockResolvedValueOnce(jsonResponse(salePriceResponse()));

      await expect(
        service.updatePublicationPrice(PRICED_ITEM_ID, 40_000),
      ).resolves.toEqual({
        ok: true,
        itemId: PRICED_ITEM_ID,
        requestedPrice: 40_000,
        listPriceAfterUpdate: 39_999,
        salePriceAfterUpdate: 24_750,
        promotionRegularPrice: 27_000,
        hasPromotion: true,
        warning: 'El precio standard no coincide con el precio solicitado',
      });
    });

    it('gets active User Product pricing without duplicate legacy fields', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      jest.spyOn(service, 'getStoredConnection').mockResolvedValue(connection);
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            id: USER_PRODUCT_ID,
            name: 'Producto de prueba',
            family_id: 'FAMILY-1',
            attributes: [],
            pictures: [],
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ results: [PRICED_ITEM_ID] }))
        .mockResolvedValueOnce(
          jsonResponse([
            {
              code: 200,
              body: {
                ...pricedItem(),
                sub_status: [],
                listing_type_id: 'gold_special',
                permalink: `https://articulo.mercadolibre.com.ar/${PRICED_ITEM_ID}`,
              },
            },
          ]),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse(salePriceResponse()));

      const result = await service.getUserProductPrices(USER_PRODUCT_ID);
      const condition = result.conditions[0];

      expect(condition).toEqual({
        itemId: PRICED_ITEM_ID,
        status: 'active',
        subStatus: [],
        listingType: 'gold_special',
        listPrice: 40_000,
        salePrice: 24_750,
        promotionRegularPrice: 27_000,
        currencyId: 'ARS',
        hasPromotion: true,
        permalink: `https://articulo.mercadolibre.com.ar/${PRICED_ITEM_ID}`,
        legacyPricing: {
          priceFromItem: 24_750,
          originalPriceFromItem: 27_000,
        },
      });
      expect(condition).not.toHaveProperty('priceFromItem');
      expect(condition).not.toHaveProperty('regularPrice');
    });

    it('keeps a User Product condition when /prices responds 403', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      jest.spyOn(service, 'getStoredConnection').mockResolvedValue(connection);
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ id: USER_PRODUCT_ID, name: 'Producto de prueba' }),
        )
        .mockResolvedValueOnce(jsonResponse({ results: [PRICED_ITEM_ID] }))
        .mockResolvedValueOnce(
          jsonResponse([
            {
              code: 200,
              body: {
                ...pricedItem(),
                sub_status: [],
                listing_type_id: 'gold_special',
              },
            },
          ]),
        )
        .mockResolvedValueOnce(
          jsonResponse(
            { message: 'No autorizado para consultar precios' },
            403,
          ),
        )
        .mockResolvedValueOnce(jsonResponse(salePriceResponse()));

      const result = await service.getUserProductPrices(USER_PRODUCT_ID);

      expect(result.conditions[0]).toMatchObject({
        itemId: PRICED_ITEM_ID,
        status: 'active',
        listPrice: null,
        salePrice: 24_750,
        promotionRegularPrice: 27_000,
        hasPromotion: false,
        priceError: {
          status: 403,
          message: 'No autorizado para consultar precios',
        },
      });
    });

    it('lists item promotions without inventing missing values', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const activePromotion = promotionResponse();
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          {
            type: 'PRICE_DISCOUNT',
            status: 'candidate',
            price: 0,
          },
          activePromotion,
        ]),
      );

      await expect(service.getItemPromotions(PRICED_ITEM_ID)).resolves.toEqual({
        itemId: PRICED_ITEM_ID,
        promotions: [
          {
            type: 'PRICE_DISCOUNT',
            status: 'candidate',
            price: 0,
          },
          {
            ...expectedPromotion(),
            name: 'Promoción anterior',
          },
        ],
        activePromotion: {
          ...expectedPromotion(),
          name: 'Promoción anterior',
        },
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(requestUrl(url)).toBe(
        `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer valid-access-token',
      );
    });

    it('returns candidate promotions without marking them as active', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock.mockResolvedValueOnce(
        jsonResponse([
          dealPromotionResponse({ status: 'candidate' }),
          promotionResponse('SELLER_CAMPAIGN', {
            id: 'SELLER-CAMPAIGN-CANDIDATE',
            status: 'candidate',
          }),
          promotionResponse('PRICE_DISCOUNT', {
            id: 'PRICE-DISCOUNT-CANDIDATE',
            status: 'candidate',
          }),
        ]),
      );

      const result = await service.getItemPromotions(PRICED_ITEM_ID);

      expect(result.promotions).toHaveLength(3);
      expect(result.activePromotion).toBeNull();
    });

    it('rejects a promotional price greater than or equal to the list price', async () => {
      const getValidAccessToken = jest.spyOn(service, 'getValidAccessToken');

      let error: unknown;
      try {
        await service.updatePublicationPricing(PRICED_ITEM_ID, {
          ...pricingInput(),
          salePrice: 40_000,
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(400);
      expect(JSON.stringify((error as HttpException).getResponse())).toContain(
        'menor',
      );
      expect(getValidAccessToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects unsupported PRICE_DISCOUNT data before any write', async () => {
      const getValidAccessToken = jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([]));

      await expect(
        service.updatePublicationPricing(PRICED_ITEM_ID, {
          ...pricingInput(),
          salePrice: 39_000,
        }),
      ).rejects.toBeInstanceOf(HttpException);
      await expect(
        service.updatePublicationPricing(PRICED_ITEM_ID, {
          ...pricingInput(),
          finishDate: '2026-08-19T00:00:00Z',
        }),
      ).rejects.toBeInstanceOf(HttpException);

      expect(getValidAccessToken).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(
        fetchMock.mock.calls.every(([, init]) =>
          init?.method === undefined ? true : init.method === 'GET',
        ),
      ).toBe(true);
    });

    it('requires confirmation before replacing an active PRICE_DISCOUNT', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const previousPromotion = promotionResponse('PRICE_DISCOUNT', {
        top_price: 24_000,
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([previousPromotion]));

      let error: unknown;
      try {
        await service.updatePublicationPricing(
          PRICED_ITEM_ID,
          pricingInput(false),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toMatchObject({
        ok: false,
        requiresConfirmation: true,
        message: 'Existe un PRICE_DISCOUNT activo y debe reemplazarse',
        activePromotion: expectedPromotion(),
      });
      expect(
        fetchMock.mock.calls.map(([input, init]) => ({
          method: init?.method ?? 'GET',
          url: requestUrl(input),
        })),
      ).toEqual([
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        },
      ]);
    });

    it('does not modify or delete an unsupported active promotion', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const smartPromotion = promotionResponse('SMART');
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([smartPromotion]));

      let error: unknown;
      try {
        await service.updatePublicationPricing(
          PRICED_ITEM_ID,
          pricingInput(true),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toMatchObject({
        ok: false,
        message:
          'La promoción activa no es PRICE_DISCOUNT y requiere un flujo específico',
        activePromotion: expectedPromotion('SMART'),
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.some(
          ([, init]) =>
            init?.method === 'PUT' ||
            init?.method === 'POST' ||
            init?.method === 'DELETE',
        ),
      ).toBe(false);
    });

    it('updates a pending DEAL without rewriting an unchanged list price', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const pendingDeal = dealPromotionResponse();
      const updatedDeal = dealPromotionResponse({ price: 0 });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([pendingDeal]))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(
          jsonResponse({ price: 30_000, original_price: 40_000 }),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([updatedDeal]))
        .mockResolvedValueOnce(jsonResponse(finalSalePriceResponse()));

      await expect(
        service.updatePublicationPricing(PRICED_ITEM_ID, dealPricingInput()),
      ).resolves.toMatchObject({
        ok: true,
        itemId: PRICED_ITEM_ID,
        promotion: {
          id: 'P-MLA17845002',
          type: 'DEAL',
          status: 'pending',
          name: 'DIA DEL NINO 2026',
        },
        pricing: {
          listPrice: 40_000,
          salePrice: 30_000,
          promotionRegularPrice: 40_000,
          currencyId: 'ARS',
          hasPromotion: true,
        },
      });

      const calls = fetchMock.mock.calls.map(([input, init]) => ({
        method: init?.method ?? 'GET',
        url: requestUrl(input),
      }));
      expect(calls).toEqual([
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/prices`,
        },
        {
          method: 'PUT',
          url: `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/prices`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/sale_price?context=channel_marketplace`,
        },
      ]);
      expect(
        calls.filter(
          (call) =>
            call.method === 'PUT' &&
            call.url === `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
        ),
      ).toHaveLength(0);
      const [, dealPutInit] = fetchMock.mock.calls[3];
      expect(jsonBody(dealPutInit)).toEqual({
        deal_price: 30_000,
        promotion_id: 'P-MLA17845002',
        promotion_type: 'DEAL',
      });
      expect(jsonBody(dealPutInit)).not.toHaveProperty('top_deal_price');
      expect(new Headers(dealPutInit?.headers).get('content-type')).toBe(
        'application/json',
      );
      expect(new Headers(dealPutInit?.headers).get('authorization')).toBe(
        'Bearer valid-access-token',
      );
    });

    it('sends top_deal_price only when an editable DEAL already has it', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const startedDeal = dealPromotionResponse({
        status: 'started',
        top_deal_price: 23_000,
      });
      const updatedDeal = dealPromotionResponse({
        status: 'started',
        price: 30_000,
        top_deal_price: 25_000,
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([startedDeal]))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(
          jsonResponse({
            price: 30_000,
            top_price: 25_000,
            original_price: 40_000,
          }),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([updatedDeal]))
        .mockResolvedValueOnce(jsonResponse(finalSalePriceResponse()));

      await expect(
        service.updatePublicationPricing(PRICED_ITEM_ID, {
          ...dealPricingInput(),
          topDealPrice: 25_000,
        }),
      ).resolves.toMatchObject({
        ok: true,
        promotion: {
          id: 'P-MLA17845002',
          type: 'DEAL',
          status: 'started',
        },
      });

      expect(jsonBody(fetchMock.mock.calls[3][1])).toEqual({
        deal_price: 30_000,
        promotion_id: 'P-MLA17845002',
        promotion_type: 'DEAL',
        top_deal_price: 25_000,
      });
    });

    it('rejects a DEAL response that does not confirm topDealPrice', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(
          jsonResponse([
            dealPromotionResponse({
              status: 'started',
              top_deal_price: 23_000,
            }),
          ]),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(
          jsonResponse({
            price: 30_000,
            top_price: 24_999,
            original_price: 40_000,
          }),
        );

      await expect(
        service.updatePublicationPricing(PRICED_ITEM_ID, {
          ...dealPricingInput(),
          topDealPrice: 25_000,
        }),
      ).rejects.toMatchObject({ status: 502 });

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('updates and verifies the list price before updating a pending DEAL', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const pendingDeal = dealPromotionResponse();
      const updatedDeal = dealPromotionResponse({ price: 30_000 });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([pendingDeal]))
        .mockResolvedValueOnce(jsonResponse(pricesResponse(35_000)))
        .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(
          jsonResponse({ price: 30_000, original_price: 40_000 }),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([updatedDeal]))
        .mockResolvedValueOnce(jsonResponse(finalSalePriceResponse()));

      await expect(
        service.updatePublicationPricing(PRICED_ITEM_ID, dealPricingInput()),
      ).resolves.toMatchObject({
        ok: true,
        promotion: {
          id: 'P-MLA17845002',
          type: 'DEAL',
          status: 'pending',
        },
      });

      const calls = fetchMock.mock.calls.map(([input, init]) => ({
        method: init?.method ?? 'GET',
        url: requestUrl(input),
      }));
      expect(calls.map(({ method }) => method)).toEqual([
        'GET',
        'GET',
        'GET',
        'PUT',
        'GET',
        'PUT',
        'GET',
        'GET',
        'GET',
      ]);
      expect(calls[3].url).toBe(
        `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
      );
      expect(fetchMock.mock.calls[3][1]?.body).toBe(
        JSON.stringify({ price: 40_000 }),
      );
      expect(calls[4].url).toBe(
        `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/prices`,
      );
      expect(calls[5].url).toBe(
        `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
      );
      expect(jsonBody(fetchMock.mock.calls[5][1])).toEqual({
        deal_price: 30_000,
        promotion_id: 'P-MLA17845002',
        promotion_type: 'DEAL',
      });
      expect(
        calls.some(({ method }) => method === 'DELETE' || method === 'POST'),
      ).toBe(false);
    });

    it.each([
      ['DEAL candidate', [dealPromotionResponse({ status: 'candidate' })]],
      [
        'SELLER_CAMPAIGN candidate',
        [
          promotionResponse('SELLER_CAMPAIGN', {
            id: 'SELLER-CAMPAIGN-CANDIDATE',
            status: 'candidate',
          }),
        ],
      ],
      [
        'PRICE_DISCOUNT candidate',
        [
          promotionResponse('PRICE_DISCOUNT', {
            id: 'PRICE-DISCOUNT-CANDIDATE',
            status: 'candidate',
          }),
        ],
      ],
      [
        'all candidate promotions',
        [
          dealPromotionResponse({ status: 'candidate' }),
          promotionResponse('SELLER_CAMPAIGN', {
            id: 'SELLER-CAMPAIGN-CANDIDATE',
            status: 'candidate',
          }),
          promotionResponse('PRICE_DISCOUNT', {
            id: 'PRICE-DISCOUNT-CANDIDATE',
            status: 'candidate',
          }),
        ],
      ],
    ] as Array<[string, Array<Record<string, unknown>>]>)(
      'ignores %s and creates a PRICE_DISCOUNT',
      async (_case, candidates) => {
        jest
          .spyOn(service, 'getValidAccessToken')
          .mockResolvedValue('valid-access-token');
        const newPromotion = promotionResponse('PRICE_DISCOUNT', {
          id: 'PRICE-DISCOUNT-NEW',
          status: 'started',
          price: 30_000,
          original_price: 50_000,
          start_date: '2026-08-04',
          finish_date: '2026-08-17',
        });
        fetchMock
          .mockResolvedValueOnce(jsonResponse(pricedItem()))
          .mockResolvedValueOnce(jsonResponse(candidates))
          .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
          .mockResolvedValueOnce(jsonResponse(pricesResponse(50_000)))
          .mockResolvedValueOnce(
            jsonResponse({ price: 30_000, original_price: 50_000 }),
          )
          .mockResolvedValueOnce(jsonResponse(pricesResponse(50_000)))
          .mockResolvedValueOnce(jsonResponse([...candidates, newPromotion]))
          .mockResolvedValueOnce(
            jsonResponse({
              amount: 30_000,
              regular_amount: 50_000,
              currency_id: 'ARS',
            }),
          );

        const result = await service.updatePublicationPricing(PRICED_ITEM_ID, {
          listPrice: 50_000,
          salePrice: 30_000,
          startDate: '2026-08-04',
          finishDate: '2026-08-17',
          confirmPromotionReplace: false,
        });

        expect(result).toMatchObject({
          ok: true,
          itemId: PRICED_ITEM_ID,
          requested: { listPrice: 50_000, salePrice: 30_000 },
          discountPercentage: 40,
          pricing: {
            listPrice: 50_000,
            salePrice: 30_000,
            promotionRegularPrice: 50_000,
            currencyId: 'ARS',
            hasPromotion: true,
          },
          promotion: {
            id: 'PRICE-DISCOUNT-NEW',
            type: 'PRICE_DISCOUNT',
            status: 'started',
          },
        });

        const promotionWrites = fetchMock.mock.calls
          .map(([input, init]) => ({
            method: init?.method ?? 'GET',
            url: requestUrl(input),
            init,
          }))
          .filter(
            ({ method, url }) =>
              ['PUT', 'POST', 'DELETE'].includes(method) &&
              url.includes('/seller-promotions/items/'),
          );
        expect(promotionWrites).toHaveLength(1);
        expect(promotionWrites[0].method).toBe('POST');
        expect(jsonBody(promotionWrites[0].init)).toEqual({
          deal_price: 30_000,
          start_date: '2026-08-04',
          finish_date: '2026-08-17',
          promotion_type: 'PRICE_DISCOUNT',
        });
      },
    );

    it('rejects a pending DEAL without a promotion id', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(
          jsonResponse([dealPromotionResponse({ id: undefined })]),
        );

      let error: unknown;
      try {
        await service.updatePublicationPricing(
          PRICED_ITEM_ID,
          dealPricingInput(),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(502);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.some(([, init]) =>
          ['PUT', 'POST', 'DELETE'].includes(init?.method ?? ''),
        ),
      ).toBe(false);
    });

    it.each([400, 403, 409])(
      'preserves a DEAL PUT error with upstream status %i',
      async (status) => {
        jest
          .spyOn(service, 'getValidAccessToken')
          .mockResolvedValue('valid-access-token');
        const upstreamError = {
          key: 'deal_price_not_allowed',
          message: 'The discounted price is not credible',
          cause: [
            {
              error_code: 'ERROR_CREDIBILITY_DISCOUNTED_PRICE',
              error_message: 'The discounted price is not credible',
            },
          ],
          error:
            status === 400
              ? 'bad_request'
              : status === 403
                ? 'forbidden'
                : 'conflict',
          status,
          access_token: 'must-not-leak',
          Authorization: 'Bearer must-not-leak',
        };
        fetchMock
          .mockResolvedValueOnce(jsonResponse(pricedItem()))
          .mockResolvedValueOnce(jsonResponse([dealPromotionResponse()]))
          .mockResolvedValueOnce(jsonResponse(pricesResponse()))
          .mockResolvedValueOnce(jsonResponse(upstreamError, status));

        let error: unknown;
        try {
          await service.updatePublicationPricing(
            PRICED_ITEM_ID,
            dealPricingInput(),
          );
        } catch (caught) {
          error = caught;
        }

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(status);
        const response = (error as HttpException).getResponse();
        expect(response).toMatchObject({
          key: upstreamError.key,
          message: upstreamError.message,
          cause: upstreamError.cause,
          error: upstreamError.error,
          status,
        });
        expect(JSON.stringify(response)).not.toContain('must-not-leak');
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(fetchMock.mock.calls[3][1]?.method).toBe('PUT');
        expect(requestUrl(fetchMock.mock.calls[3][0])).toBe(
          `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        );
      },
    );

    it('returns a preview without external calls when confirmation is false', async () => {
      const getValidAccessToken = jest.spyOn(service, 'getValidAccessToken');

      await expect(
        service.replaceDealWithPriceDiscount(
          PRICED_ITEM_ID,
          replaceDealInput(false),
        ),
      ).resolves.toEqual({
        ok: true,
        preview: true,
        requiresConfirmation: true,
        message: 'Vista previa: no se realizó ningún cambio',
        itemId: PRICED_ITEM_ID,
        requested: {
          listPrice: 40_000,
          salePrice: 30_000,
          startDate: PROMOTION_START_DATE,
          finishDate: PROMOTION_FINISH_DATE,
        },
        discountPercentage: 25,
        operations: {
          removeCurrentDeal: true,
          updateListPrice: 40_000,
          createPriceDiscount: {
            salePrice: 30_000,
            startDate: PROMOTION_START_DATE,
            finishDate: PROMOTION_FINISH_DATE,
          },
        },
      });

      expect(getValidAccessToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['pending', 'started'])(
      'replaces a %s DEAL using the separate destructive flow',
      async (dealStatus) => {
        jest
          .spyOn(service, 'getValidAccessToken')
          .mockResolvedValue('valid-access-token');
        const previousDeal = dealPromotionResponse({ status: dealStatus });
        const finalPriceDiscountStatus =
          dealStatus === 'pending' ? 'sync_requested' : 'started';
        const newPromotion = promotionResponse('PRICE_DISCOUNT', {
          id: 'OFFER-MLA3042295334-NEW',
          status: finalPriceDiscountStatus,
          price: 30_000,
          original_price: 40_000,
          start_date: PROMOTION_START_DATE,
          finish_date: PROMOTION_FINISH_DATE,
          name: 'Nuevo descuento',
        });
        fetchMock
          .mockResolvedValueOnce(jsonResponse(pricedItem()))
          .mockResolvedValueOnce(jsonResponse([previousDeal]))
          .mockResolvedValueOnce(emptyResponse(200))
          .mockResolvedValueOnce(jsonResponse([]))
          .mockResolvedValueOnce(jsonResponse(pricesResponse(35_000)))
          .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
          .mockResolvedValueOnce(jsonResponse(pricesResponse()))
          .mockResolvedValueOnce(
            jsonResponse({ price: 30_000, original_price: 40_000 }),
          )
          .mockResolvedValueOnce(jsonResponse(pricesResponse()))
          .mockResolvedValueOnce(jsonResponse([newPromotion]))
          .mockResolvedValueOnce(jsonResponse(finalSalePriceResponse()));

        await expect(
          service.replaceDealWithPriceDiscount(
            PRICED_ITEM_ID,
            replaceDealInput(),
          ),
        ).resolves.toMatchObject({
          ok: true,
          itemId: PRICED_ITEM_ID,
          previousDealDeleted: true,
          newPromotionRequestAccepted: true,
          newPromotionCreated: true,
          requested: { listPrice: 40_000, salePrice: 30_000 },
          discountPercentage: 25,
          pricing: {
            listPrice: 40_000,
            salePrice: 30_000,
            promotionRegularPrice: 40_000,
            currencyId: 'ARS',
            hasPromotion: true,
          },
          promotion: {
            id: 'OFFER-MLA3042295334-NEW',
            type: 'PRICE_DISCOUNT',
            status: finalPriceDiscountStatus,
          },
        });

        const calls = fetchMock.mock.calls.map(([input, init]) => ({
          method: init?.method ?? 'GET',
          url: new URL(requestUrl(input)),
        }));
        expect(calls.map(({ method }) => method)).toEqual([
          'GET',
          'GET',
          'DELETE',
          'GET',
          'GET',
          'PUT',
          'GET',
          'POST',
          'GET',
          'GET',
          'GET',
        ]);
        expect(calls[2].url.pathname).toBe(
          `/seller-promotions/items/${PRICED_ITEM_ID}`,
        );
        expect(calls[2].url.searchParams.get('promotion_type')).toBe('DEAL');
        expect(calls[2].url.searchParams.get('promotion_id')).toBe(
          'P-MLA17845002',
        );
        expect(calls[2].url.searchParams.get('app_version')).toBe('v2');
        expect(fetchMock.mock.calls[2][1]?.body).toBeUndefined();
        expect(calls[5].url.href).toBe(
          `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
        );
        expect(jsonBody(fetchMock.mock.calls[5][1])).toEqual({ price: 40_000 });
        expect(calls[7].url.href).toBe(
          `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        );
        expect(jsonBody(fetchMock.mock.calls[7][1])).toEqual({
          deal_price: 30_000,
          start_date: PROMOTION_START_DATE,
          finish_date: PROMOTION_FINISH_DATE,
          promotion_type: 'PRICE_DISCOUNT',
        });
        expect(
          fetchMock.mock.calls.some(
            ([input, init]) =>
              init?.method === 'PUT' &&
              requestUrl(input).includes('/seller-promotions/items/'),
          ),
        ).toBe(false);
      },
    );

    it.each([
      ['candidate DEAL', dealPromotionResponse({ status: 'candidate' })],
      ['another promotion type', promotionResponse('SMART')],
    ])('does not mutate %s', async (_label, promotion) => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([promotion]));

      await expect(
        service.replaceDealWithPriceDiscount(
          PRICED_ITEM_ID,
          replaceDealInput(),
        ),
      ).rejects.toMatchObject({ status: 409 });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.some(([, init]) =>
          ['DELETE', 'PUT', 'POST'].includes(init?.method ?? ''),
        ),
      ).toBe(false);
    });

    it('does not remove DEAL from a paused publication', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ ...pricedItem(), status: 'paused' }),
      );

      await expect(
        service.replaceDealWithPriceDiscount(
          PRICED_ITEM_ID,
          replaceDealInput(),
        ),
      ).rejects.toMatchObject({ status: 400 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
      ).toBe(false);
    });

    it.each(['restore_requested', 'sync_requested'])(
      'does not remove DEAL while PRICE_DISCOUNT is %s',
      async (status) => {
        jest
          .spyOn(service, 'getValidAccessToken')
          .mockResolvedValue('valid-access-token');
        fetchMock
          .mockResolvedValueOnce(jsonResponse(pricedItem()))
          .mockResolvedValueOnce(
            jsonResponse([
              dealPromotionResponse(),
              promotionResponse('PRICE_DISCOUNT', { status }),
            ]),
          );

        await expect(
          service.replaceDealWithPriceDiscount(
            PRICED_ITEM_ID,
            replaceDealInput(),
          ),
        ).rejects.toMatchObject({ status: 409 });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(
          fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
        ).toBe(false);
      },
    );

    it('preserves a safe Mercado Libre error when DEAL DELETE fails', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const upstreamError = {
        key: 'promotion_not_allowed',
        message: 'The DEAL cannot be removed',
        error: 'forbidden',
        cause: [{ code: 'deal_locked', message: 'Campaign is locked' }],
        access_token: 'must-not-leak',
      };
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([dealPromotionResponse()]))
        .mockResolvedValueOnce(jsonResponse(upstreamError, 403));

      let error: unknown;
      try {
        await service.replaceDealWithPriceDiscount(
          PRICED_ITEM_ID,
          replaceDealInput(),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
      const response = (error as HttpException).getResponse();
      expect(response).toMatchObject({
        key: upstreamError.key,
        message: upstreamError.message,
        error: upstreamError.error,
        cause: upstreamError.cause,
      });
      expect(JSON.stringify(response)).not.toContain('must-not-leak');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('reports partial state when PRICE_DISCOUNT creation fails after DELETE', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const upstreamError = {
        key: 'promotion_not_allowed',
        message: 'The PRICE_DISCOUNT cannot be created',
        error: 'forbidden',
        cause: [{ code: 'invalid_deal_price', message: 'Invalid price' }],
        refresh_token: 'must-not-leak',
      };
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([dealPromotionResponse()]))
        .mockResolvedValueOnce(emptyResponse(200))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse(upstreamError, 403));

      let error: unknown;
      try {
        await service.replaceDealWithPriceDiscount(
          PRICED_ITEM_ID,
          replaceDealInput(),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
      const response = (error as HttpException).getResponse();
      expect(response).toMatchObject({
        ok: false,
        dealDeleteAccepted: true,
        previousDealDeleted: true,
        listPriceUpdated: true,
        newPromotionRequestAccepted: false,
        newPromotionCreated: false,
        mercadoLibreError: {
          key: upstreamError.key,
          message: upstreamError.message,
          error: upstreamError.error,
          cause: upstreamError.cause,
        },
      });
      expect(JSON.stringify(response)).not.toContain('must-not-leak');
      expect(fetchMock).toHaveBeenCalledTimes(6);
      expect(
        fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET'),
      ).toEqual(['GET', 'GET', 'DELETE', 'GET', 'GET', 'POST']);
    });

    it('does not return success when PRICE_DISCOUNT is missing at the end', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([dealPromotionResponse()]))
        .mockResolvedValueOnce(emptyResponse(200))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(
          jsonResponse({ price: 30_000, original_price: 40_000 }),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse(finalSalePriceResponse()));

      let error: unknown;
      try {
        await service.replaceDealWithPriceDiscount(
          PRICED_ITEM_ID,
          replaceDealInput(),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(502);
      expect((error as HttpException).getResponse()).toMatchObject({
        ok: false,
        previousDealDeleted: true,
        listPriceUpdated: true,
        newPromotionRequestAccepted: true,
        newPromotionCreated: false,
      });
    });

    it('creates a PRICE_DISCOUNT when there is no active promotion', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const newPromotion = promotionResponse('PRICE_DISCOUNT', {
        id: 'OFFER-MLA3042295334-NEW',
        price: 30_000,
        original_price: 40_000,
        start_date: PROMOTION_START_DATE,
        finish_date: PROMOTION_FINISH_DATE,
        name: 'Nuevo descuento',
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(
          jsonResponse({ price: 30_000, original_price: 40_000 }),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([newPromotion]))
        .mockResolvedValueOnce(jsonResponse(finalSalePriceResponse()));

      const result = await service.updatePublicationPricing(
        PRICED_ITEM_ID,
        pricingInput(true),
      );

      expect(result).toMatchObject({
        ok: true,
        itemId: PRICED_ITEM_ID,
        requested: { listPrice: 40_000, salePrice: 30_000 },
        discountPercentage: 25,
        pricing: {
          listPrice: 40_000,
          salePrice: 30_000,
          promotionRegularPrice: 40_000,
          currencyId: 'ARS',
          hasPromotion: true,
        },
        promotion: {
          id: 'OFFER-MLA3042295334-NEW',
          type: 'PRICE_DISCOUNT',
          status: 'started',
          startDate: PROMOTION_START_DATE,
          finishDate: PROMOTION_FINISH_DATE,
        },
      });
      expect(
        fetchMock.mock.calls.map(([input, init]) => ({
          method: init?.method ?? 'GET',
          url: requestUrl(input),
        })),
      ).toEqual([
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        },
        {
          method: 'PUT',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/prices`,
        },
        {
          method: 'POST',
          url: `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/prices`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
        },
        {
          method: 'GET',
          url: `https://api.mercadolibre.com/items/${PRICED_ITEM_ID}/sale_price?context=channel_marketplace`,
        },
      ]);
      const [, putInit] = fetchMock.mock.calls[2];
      expect(putInit?.body).toBe(JSON.stringify({ price: 40_000 }));
      const [, postInit] = fetchMock.mock.calls[4];
      expect(postInit?.body).toBe(
        JSON.stringify({
          deal_price: 30_000,
          start_date: PROMOTION_START_DATE,
          finish_date: PROMOTION_FINISH_DATE,
          promotion_type: 'PRICE_DISCOUNT',
        }),
      );
      expect(new Headers(postInit?.headers).get('authorization')).toBe(
        'Bearer valid-access-token',
      );
      expect(new Headers(postInit?.headers).get('content-type')).toBe(
        'application/json',
      );
    });

    it('replaces an active PRICE_DISCOUNT after explicit confirmation', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const previousPromotion = promotionResponse();
      const newPromotion = promotionResponse('PRICE_DISCOUNT', {
        id: 'OFFER-MLA3042295334-NEW',
        price: 30_000,
        original_price: 40_000,
        start_date: PROMOTION_START_DATE,
        finish_date: PROMOTION_FINISH_DATE,
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([previousPromotion]))
        .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([previousPromotion]))
        .mockResolvedValueOnce(emptyResponse(200))
        .mockResolvedValueOnce(
          jsonResponse({ price: 30_000, original_price: 40_000 }),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([newPromotion]))
        .mockResolvedValueOnce(jsonResponse(finalSalePriceResponse()));

      await expect(
        service.updatePublicationPricing(PRICED_ITEM_ID, pricingInput(true)),
      ).resolves.toMatchObject({
        ok: true,
        itemId: PRICED_ITEM_ID,
        requested: { listPrice: 40_000, salePrice: 30_000 },
        pricing: { listPrice: 40_000, salePrice: 30_000 },
        promotion: { id: 'OFFER-MLA3042295334-NEW' },
      });

      const calls = fetchMock.mock.calls.map(([input, init]) => ({
        method: init?.method ?? 'GET',
        url: new URL(requestUrl(input)),
      }));
      expect(calls.map(({ method }) => method)).toEqual([
        'GET',
        'GET',
        'PUT',
        'GET',
        'GET',
        'DELETE',
        'POST',
        'GET',
        'GET',
        'GET',
      ]);
      expect(calls[5].url.pathname).toBe(
        `/seller-promotions/items/${PRICED_ITEM_ID}`,
      );
      expect(calls[5].url.searchParams.get('promotion_type')).toBe(
        'PRICE_DISCOUNT',
      );
      expect(calls[5].url.searchParams.get('app_version')).toBe('v2');
      expect(fetchMock.mock.calls[5][1]?.body).toBeUndefined();
      expect(calls[6].url.href).toBe(
        `https://api.mercadolibre.com/seller-promotions/items/${PRICED_ITEM_ID}?app_version=v2`,
      );
    });

    it('skips DELETE when the list price update already removed the discount', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const previousPromotion = promotionResponse();
      const newPromotion = promotionResponse('PRICE_DISCOUNT', {
        id: 'OFFER-MLA3042295334-NEW',
        price: 30_000,
        original_price: 40_000,
        start_date: PROMOTION_START_DATE,
        finish_date: PROMOTION_FINISH_DATE,
      });
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([previousPromotion]))
        .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(
          jsonResponse({ price: 30_000, original_price: 40_000 }),
        )
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([newPromotion]))
        .mockResolvedValueOnce(jsonResponse(finalSalePriceResponse()));

      await expect(
        service.updatePublicationPricing(PRICED_ITEM_ID, pricingInput(true)),
      ).resolves.toMatchObject({
        ok: true,
        pricing: { listPrice: 40_000, salePrice: 30_000 },
        promotion: { id: 'OFFER-MLA3042295334-NEW' },
      });

      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
      ).toBe(false);
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
      ).toHaveLength(1);
    });

    it('preserves the upstream error when POST fails after DELETE', async () => {
      jest
        .spyOn(service, 'getValidAccessToken')
        .mockResolvedValue('valid-access-token');
      const previousPromotion = promotionResponse('PRICE_DISCOUNT', {
        top_price: 24_000,
      });
      const upstreamError = {
        key: 'promotion_not_allowed',
        message: 'The requested promotion is not allowed',
        cause: [{ code: 'invalid_deal_price', message: 'Invalid deal price' }],
        error: 'forbidden',
        access_token: 'must-not-leak',
        Authorization: 'Bearer must-not-leak',
      };
      fetchMock
        .mockResolvedValueOnce(jsonResponse(pricedItem()))
        .mockResolvedValueOnce(jsonResponse([previousPromotion]))
        .mockResolvedValueOnce(jsonResponse({ id: PRICED_ITEM_ID }))
        .mockResolvedValueOnce(jsonResponse(pricesResponse()))
        .mockResolvedValueOnce(jsonResponse([previousPromotion]))
        .mockResolvedValueOnce(emptyResponse(200))
        .mockResolvedValueOnce(jsonResponse(upstreamError, 403));

      let error: unknown;
      try {
        await service.updatePublicationPricing(
          PRICED_ITEM_ID,
          pricingInput(true),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
      const response = (error as HttpException).getResponse();
      expect(response).toMatchObject({
        ok: false,
        listPriceUpdated: true,
        previousPromotionDeleted: true,
        newPromotionCreated: false,
        message:
          'Se actualizó el precio de lista, pero falló la creación de la nueva promoción',
        previousPromotion: {
          ...expectedPromotion(),
          topPrice: 24_000,
        },
        mercadoLibreError: {
          key: upstreamError.key,
          message: upstreamError.message,
          cause: upstreamError.cause,
          error: upstreamError.error,
        },
      });
      expect(JSON.stringify(response)).not.toContain('must-not-leak');
      expect(fetchMock).toHaveBeenCalledTimes(7);
      expect(fetchMock.mock.calls[5][1]?.method).toBe('DELETE');
      expect(fetchMock.mock.calls[6][1]?.method).toBe('POST');
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
