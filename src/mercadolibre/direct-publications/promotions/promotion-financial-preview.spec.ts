import { normalizePromotionFinancialPreview } from './promotion-financial-preview';

describe('normalizePromotionFinancialPreview', () => {
  it('prioriza el aporte absoluto de ML y calcula el aporte vendedor por diferencia', () => {
    const result = normalizePromotionFinancialPreview({
      promotionType: 'MARKETPLACE_CAMPAIGN',
      currentPrice: 60000,
      rawPromotionPrice: 52380,
      minPromotionPrice: null,
      maxPromotionPrice: null,
      suggestedPromotionPrice: null,

      // Pueden venir informados por ML,
      // pero el monto absoluto tiene prioridad.
      meliPercentage: 3.5,
      sellerPercentage: 9.2,

      discountMeliAmount: 2095.2,
      discountMeliBoostAmount: 0,

      deferFinancialsWhenPriceSelectionRequired: false,
    });

    expect(result).toMatchObject({
      promotionPrice: 52380,

      mercadoLibreBaseContributionAmount: 2095.2,
      mercadoLibreBoostAmount: 0,
      mercadoLibreContributionAmount: 2095.2,

      sellerDiscountAmount: 5524.8,
    });
  });

  it('usa porcentajes como fallback cuando ML no entrega monto absoluto', () => {
    const result = normalizePromotionFinancialPreview({
      promotionType: 'SELLER_CAMPAIGN',
      currentPrice: 100,
      rawPromotionPrice: 90,
      minPromotionPrice: null,
      maxPromotionPrice: null,
      suggestedPromotionPrice: null,

      meliPercentage: 20,
      sellerPercentage: 80,

      discountMeliAmount: null,
      discountMeliBoostAmount: 0,

      deferFinancialsWhenPriceSelectionRequired: false,
    });

    expect(result).toMatchObject({
      promotionPrice: 90,
      mercadoLibreContributionAmount: 2,
      sellerDiscountAmount: 8,
    });
  });

  it('mantiene importes null cuando todavía no hay precio para calcular', () => {
    const result = normalizePromotionFinancialPreview({
      promotionType: 'MARKETPLACE_CAMPAIGN',
      currentPrice: 20000,
      rawPromotionPrice: 0,
      minPromotionPrice: null,
      maxPromotionPrice: null,
      suggestedPromotionPrice: null,

      meliPercentage: 25,
      sellerPercentage: 75,

      discountMeliAmount: null,
      discountMeliBoostAmount: null,

      deferFinancialsWhenPriceSelectionRequired: true,
    });

    expect(result).toMatchObject({
      promotionPrice: null,
      effectiveCalculationPrice: null,
      sellerDiscountAmount: null,
      mercadoLibreContributionAmount: null,
    });
  });
});
