import { ConflictException } from '@nestjs/common';
import type { NormalizedPromotion } from './publication-promotions.helpers';
import {
  assertApplicablePriceDiscount,
  hasRemovablePriceDiscount,
  isRemovablePriceDiscountStatus,
} from './publication-price-discount-policy';

const CANDIDATE: NormalizedPromotion = {
  promotionId: null,
  offerId: null,
  type: 'PRICE_DISCOUNT',
  status: 'candidate',
  price: null,
  originalPrice: 1_000,
  promotionPercentage: null,
  startDate: null,
  endDate: null,
  name: null,
  minDiscountedPrice: 700,
  maxDiscountedPrice: 850,
  suggestedDiscountedPrice: 800,
  topDealPrice: null,
  boostedOffer: false,
};

describe('publication-price-discount-policy', () => {
  it.each([700, 800, 850])(
    'acepta un candidato dentro del rango informado por ML',
    (dealPrice) => {
      expect(() =>
        assertApplicablePriceDiscount([CANDIDATE], dealPrice),
      ).not.toThrow();
    },
  );

  it('rechaza cuando no existe un candidato PRICE_DISCOUNT', () => {
    expect(() =>
      assertApplicablePriceDiscount(
        [{ ...CANDIDATE, type: 'DEAL', status: 'candidate' }],
        800,
      ),
    ).toThrow(ConflictException);
    expect(() =>
      assertApplicablePriceDiscount([{ ...CANDIDATE, status: 'started' }], 800),
    ).toThrow('La publicación no es elegible para PRICE_DISCOUNT');
  });

  it.each([
    [699, 'El precio promocional mínimo es 700'],
    [851, 'El precio promocional máximo es 850'],
  ])('rechaza precios fuera del rango del candidato', (dealPrice, message) => {
    expect(() => assertApplicablePriceDiscount([CANDIDATE], dealPrice)).toThrow(
      message,
    );
  });

  it.each(['started', 'pending', 'sync_requested'])(
    'considera removible un PRICE_DISCOUNT activo o en proceso',
    (status) => {
      expect(hasRemovablePriceDiscount([{ ...CANDIDATE, status }])).toBe(true);
      expect(isRemovablePriceDiscountStatus(status)).toBe(true);
    },
  );

  it.each(['candidate', 'finished', null])(
    'no considera removible un PRICE_DISCOUNT sin aplicacion vigente',
    (status) => {
      expect(hasRemovablePriceDiscount([{ ...CANDIDATE, status }])).toBe(false);
      expect(isRemovablePriceDiscountStatus(status)).toBe(false);
    },
  );

  it('ignora promociones removibles que no sean PRICE_DISCOUNT', () => {
    expect(
      hasRemovablePriceDiscount([
        { ...CANDIDATE, type: 'DEAL', status: 'started' },
      ]),
    ).toBe(false);
  });
});
