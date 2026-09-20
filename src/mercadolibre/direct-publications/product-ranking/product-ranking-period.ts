import { BadRequestException } from '@nestjs/common';

export const PRODUCT_RANKING_VISIT_PERIODS = [
  7,
  10,
  15,
  30,
  60,
  90,
  120,
  150,
] as const;

export type ProductRankingVisitPeriod =
  (typeof PRODUCT_RANKING_VISIT_PERIODS)[number];

export const DEFAULT_PRODUCT_RANKING_VISIT_PERIOD: ProductRankingVisitPeriod =
  30;

export function parseProductRankingVisitPeriod(
  value: unknown,
): ProductRankingVisitPeriod {
  if (value === undefined) return DEFAULT_PRODUCT_RANKING_VISIT_PERIOD;
  if (
    typeof value === 'string' &&
    PRODUCT_RANKING_VISIT_PERIODS.some((period) => String(period) === value)
  ) {
    return Number(value) as ProductRankingVisitPeriod;
  }
  throw new BadRequestException(
    `days debe ser uno de: ${PRODUCT_RANKING_VISIT_PERIODS.join(', ')}`,
  );
}
