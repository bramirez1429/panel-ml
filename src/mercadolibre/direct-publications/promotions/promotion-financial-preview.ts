export type PromotionFinancialPreview = Readonly<{
  promotionPrice: number | null;
  minPromotionPrice: number | null;
  maxPromotionPrice: number | null;
  suggestedPromotionPrice: number | null;
  requiresPriceSelection: boolean | null;
  sellerDiscountAmount: number | null;
  mercadoLibreBaseContributionAmount: number | null;
  mercadoLibreBoostAmount: number | null;
  mercadoLibreContributionAmount: number | null;
  effectiveCalculationPrice: number | null;
}>;

export function normalizePromotionFinancialPreview(input: {
  promotionType: string | null;
  currentPrice: number | null;
  rawPromotionPrice: number | null;
  minPromotionPrice: number | null;
  maxPromotionPrice: number | null;
  suggestedPromotionPrice: number | null;
  meliPercentage: number | null;
  sellerPercentage: number | null;
  discountMeliAmount: number | null;
  discountMeliBoostAmount: number | null;
  deferFinancialsWhenPriceSelectionRequired: boolean;
}): PromotionFinancialPreview {
  const promotionPrice =
    input.rawPromotionPrice === 0 ? null : input.rawPromotionPrice;
  const requiresPriceSelection =
    input.rawPromotionPrice === null ? null : input.rawPromotionPrice === 0;
  const effectiveCalculationPrice =
    input.deferFinancialsWhenPriceSelectionRequired &&
    requiresPriceSelection === true
      ? null
      : input.promotionType === 'DEAL'
        ? (promotionPrice ??
          input.maxPromotionPrice ??
          input.suggestedPromotionPrice)
        : (promotionPrice ?? input.suggestedPromotionPrice);
  const totalDiscount = discountAmountOf(
    input.currentPrice,
    effectiveCalculationPrice,
  );
  const baseContribution =
    input.promotionType === 'DEAL'
      ? 0
      : (input.discountMeliAmount ??
        percentageAmount(totalDiscount, input.meliPercentage));
  const contribution = contributionOf(
    baseContribution,
    input.discountMeliBoostAmount,
  );
  const sellerDiscount =
    input.promotionType === 'DEAL'
      ? roundMoney(
          sellerDiscountOf(
            input.currentPrice,
            effectiveCalculationPrice,
            contribution,
          ),
        )
      : (sellerDiscountOf(
          input.currentPrice,
          effectiveCalculationPrice,
          contribution,
        ) ??
        percentageAmount(totalDiscount, input.sellerPercentage));
  return {
    promotionPrice,
    minPromotionPrice: input.minPromotionPrice,
    maxPromotionPrice: input.maxPromotionPrice,
    suggestedPromotionPrice: input.suggestedPromotionPrice,
    requiresPriceSelection,
    sellerDiscountAmount: sellerDiscount,
    mercadoLibreBaseContributionAmount: baseContribution,
    mercadoLibreBoostAmount: input.discountMeliBoostAmount,
    mercadoLibreContributionAmount: contribution,
    effectiveCalculationPrice,
  };
}

function discountAmountOf(
  currentPrice: number | null,
  promotionPrice: number | null,
): number | null {
  if (currentPrice === null || promotionPrice === null) return null;
  const discount = currentPrice - promotionPrice;
  return discount >= 0 ? discount : null;
}

function percentageAmount(
  amount: number | null,
  percentage: number | null,
): number | null {
  if (
    amount === null ||
    percentage === null ||
    percentage < 0 ||
    percentage > 100
  )
    return null;
  return Math.round(amount * percentage) / 100;
}

function contributionOf(
  baseContribution: number | null,
  boost: number | null,
): number | null {
  if (baseContribution === null && boost === null) return null;
  return (baseContribution ?? 0) + (boost ?? 0);
}

function sellerDiscountOf(
  currentPrice: number | null,
  promotionPrice: number | null,
  contribution: number | null,
): number | null {
  if (currentPrice === null || promotionPrice === null || contribution === null)
    return null;
  const amount = currentPrice - promotionPrice - contribution;
  return amount >= 0 ? amount : null;
}

function roundMoney(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
