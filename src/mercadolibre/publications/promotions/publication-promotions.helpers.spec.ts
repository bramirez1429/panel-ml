import { BadGatewayException, BadRequestException } from '@nestjs/common';
import {
  normalizePromotions,
  parsePriceDiscountInput,
} from './publication-promotions.helpers';

describe('publication-promotions helpers', () => {
  it('normaliza la respuesta results de seller-promotions', () => {
    expect(
      normalizePromotions({
        results: [
          {
            id: 'PROMO-1',
            ref_id: 'OFFER-1',
            type: 'PRICE_DISCOUNT',
            status: 'started',
            price: 800,
            original_price: 1_000,
            start_date: '2026-08-01T00:00:00Z',
            finish_date: '2026-08-14T23:59:59Z',
            name: 'Oferta agosto',
            min_discounted_price: 750,
            max_discounted_price: 850,
            suggested_discounted_price: 790,
            top_deal_price: 780,
            boosted_offer: true,
          },
        ],
      }),
    ).toEqual([
      {
        promotionId: 'PROMO-1',
        offerId: 'OFFER-1',
        type: 'PRICE_DISCOUNT',
        status: 'started',
        price: 800,
        originalPrice: 1_000,
        promotionPercentage: 20,
        startDate: '2026-08-01T00:00:00Z',
        endDate: '2026-08-14T23:59:59Z',
        name: 'Oferta agosto',
        minDiscountedPrice: 750,
        maxDiscountedPrice: 850,
        suggestedDiscountedPrice: 790,
        topDealPrice: 780,
        boostedOffer: true,
      },
    ]);
  });

  it('acepta exactamente 14 dias calendario para PRICE_DISCOUNT', () => {
    expect(
      parsePriceDiscountInput({
        dealPrice: 800,
        topDealPrice: 780,
        startDate: '2026-08-01',
        finishDate: '2026-08-14',
        itemId: 'MLA100',
      }),
    ).toEqual({
      dealPrice: 800,
      topDealPrice: 780,
      startDate: '2026-08-01',
      finishDate: '2026-08-14',
      itemId: 'MLA100',
      variationId: undefined,
      userProductId: undefined,
    });
  });

  it('rechaza PRICE_DISCOUNT de 15 dias y respuestas invalidas', () => {
    expect(() =>
      parsePriceDiscountInput({
        dealPrice: 800,
        startDate: '2026-08-01',
        finishDate: '2026-08-15',
      }),
    ).toThrow(BadRequestException);
    expect(() => normalizePromotions({ results: [{}] })).toThrow(
      BadGatewayException,
    );
  });

  it('rechaza un fin que no sea posterior al inicio', () => {
    expect(() =>
      parsePriceDiscountInput({
        dealPrice: 800,
        startDate: '2026-08-01T18:00:00Z',
        finishDate: '2026-08-01T17:00:00Z',
      }),
    ).toThrow(BadRequestException);
  });
});
