import { BadGatewayException } from '@nestjs/common';
import {
  discountPercentage,
  normalizePricesResponse,
  normalizeSalePrice,
  selectPrice,
} from './publication-prices.helpers';

describe('publication-prices helpers', () => {
  it('normaliza standard y promotion y prioriza channel_marketplace', () => {
    const prices = normalizePricesResponse(
      {
        id: 'MLA100',
        prices: [
          {
            id: 'standard-default',
            type: 'standard',
            amount: 1_100,
            currency_id: 'ARS',
            conditions: { context_restrictions: [] },
          },
          {
            id: 'standard-marketplace',
            type: 'standard',
            amount: 1_000,
            currency_id: 'ARS',
            conditions: {
              context_restrictions: ['channel_marketplace'],
            },
          },
          {
            id: 'promotion-marketplace',
            type: 'promotion',
            amount: 800,
            regular_amount: 1_000,
            currency_id: 'ARS',
            conditions: {
              context_restrictions: ['channel_marketplace'],
              start_time: '2026-08-01T00:00:00Z',
              end_time: '2026-08-14T23:59:59Z',
            },
            metadata: {
              promotion_id: 'PROMO-1',
              promotion_type: 'PRICE_DISCOUNT',
            },
          },
        ],
      },
      'MLA100',
    );

    expect(selectPrice(prices, 'standard')).toMatchObject({
      id: 'standard-marketplace',
      amount: 1_000,
    });
    expect(selectPrice(prices, 'promotion')).toMatchObject({
      id: 'promotion-marketplace',
      amount: 800,
      regularAmount: 1_000,
      promotionId: 'PROMO-1',
      promotionType: 'PRICE_DISCOUNT',
      startDate: '2026-08-01T00:00:00Z',
      endDate: '2026-08-14T23:59:59Z',
    });
    expect(discountPercentage(1_000, 800)).toBe(20);
  });

  it('normaliza /sale_price y rechaza una respuesta de otro item', () => {
    expect(
      normalizeSalePrice({
        amount: 800,
        regular_amount: 1_000,
        currency_id: 'ARS',
        metadata: {
          promotion_id: 'PROMO-1',
          promotion_type: 'PRICE_DISCOUNT',
        },
      }),
    ).toEqual({
      amount: 800,
      regularAmount: 1_000,
      currencyId: 'ARS',
      promotionId: 'PROMO-1',
      promotionType: 'PRICE_DISCOUNT',
    });

    expect(() =>
      normalizePricesResponse({ id: 'MLA999', prices: [] }, 'MLA100'),
    ).toThrow(BadGatewayException);
  });

  it('no usa precios B2B ni por cantidad como standard general', () => {
    const prices = normalizePricesResponse(
      {
        id: 'MLA100',
        prices: [
          {
            id: 'business',
            type: 'standard',
            amount: 700,
            conditions: {
              context_restrictions: [
                'channel_marketplace',
                'user_type_business',
              ],
            },
          },
          {
            id: 'quantity',
            type: 'standard',
            amount: 750,
            conditions: {
              context_restrictions: ['channel_marketplace'],
              min_purchase_unit: 5,
            },
          },
          {
            id: 'general',
            type: 'standard',
            amount: 1_000,
            conditions: {
              context_restrictions: ['channel_marketplace'],
            },
          },
        ],
      },
      'MLA100',
    );

    expect(selectPrice(prices, 'standard')?.id).toBe('general');
  });
});
