import { BadRequestException } from '@nestjs/common';

import {
  DEFAULT_PRODUCT_RANKING_VISIT_PERIOD,
  PRODUCT_RANKING_VISIT_PERIODS,
  parseProductRankingVisitPeriod,
} from './product-ranking-period';

describe('parseProductRankingVisitPeriod', () => {
  it.each(PRODUCT_RANKING_VISIT_PERIODS)('acepta days=%i', (days) => {
    expect(parseProductRankingVisitPeriod(String(days))).toBe(days);
  });

  it('usa 30 días cuando days no está presente', () => {
    expect(parseProductRankingVisitPeriod(undefined)).toBe(
      DEFAULT_PRODUCT_RANKING_VISIT_PERIOD,
    );
  });

  it.each(['25', '0', '200', 'abc', '', ['30']])(
    'rechaza days=%p con 400',
    (days) => {
      expect(() => parseProductRankingVisitPeriod(days)).toThrow(
        BadRequestException,
      );
      try {
        parseProductRankingVisitPeriod(days);
      } catch (error) {
        expect((error as BadRequestException).getStatus()).toBe(400);
      }
    },
  );
});
