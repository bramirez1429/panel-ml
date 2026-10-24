import type {
  ManagedActivePromotion,
  PromotionSwitchRequest,
} from './promotion-manager.types';
import type { MlPromotions } from './promotions.types';
import type { PromotionRemovalSelection } from './publication-promotion.types';

export function findConfirmedParticipation(
  promotions: Pick<MlPromotions, 'active' | 'pending'>,
  request: PromotionSwitchRequest,
): Readonly<{
  promotion: ManagedActivePromotion;
  status: 'pending' | 'started';
}> | null {
  const active = promotions.active.find((promotion) =>
    promotionMatchesRequest(promotion, request),
  );
  if (active) return { promotion: active, status: 'started' };
  const pending = promotions.pending.find((promotion) =>
    promotionMatchesRequest(promotion, request),
  );
  return pending ? { promotion: pending, status: 'pending' } : null;
}

export function findRequestedCandidate(
  candidates: readonly ManagedActivePromotion[],
  request: PromotionSwitchRequest,
): ManagedActivePromotion | null {
  return (
    candidates.find((candidate) =>
      promotionMatchesRequest(candidate, request, true),
    ) ?? null
  );
}

export function promotionMatchesRequest(
  promotion: ManagedActivePromotion,
  request: PromotionSwitchRequest,
  validateTerms = false,
): boolean {
  if (promotion.type !== request.type) return false;
  if (request.type !== 'PRICE_DISCOUNT' && promotion.id !== request.promotionId)
    return false;
  if (
    request.type === 'SMART' &&
    (promotion.ref_id ?? promotion.offer_id) !== request.offerId
  )
    return false;
  if (!validateTerms) return true;
  if ('dealPrice' in request) {
    if (!Number.isFinite(request.dealPrice) || request.dealPrice <= 0)
      return false;

    // A candidate can have a suggested/current price. That value is NOT
    // a fixed allowed price; Mercado Libre validates the chosen deal_price.
    const minimum = promotion.min_discounted_price;
    const maximum = promotion.max_discounted_price;
    if (typeof minimum === 'number' && request.dealPrice < minimum) return false;
    if (typeof maximum === 'number' && request.dealPrice > maximum) return false;
  }
  return (
    request.type !== 'PRICE_DISCOUNT' ||
    datesAreValid(promotion, request.startDate, request.finishDate)
  );
}

export function samePromotion(
  left: ManagedActivePromotion,
  right: ManagedActivePromotion,
): boolean {
  return (
    left.type === right.type &&
    left.id === right.id &&
    (left.ref_id ?? left.offer_id) === (right.ref_id ?? right.offer_id)
  );
}

export function promotionMatchesRemoval(
  promotion: ManagedActivePromotion,
  selection: PromotionRemovalSelection,
): boolean {
  return (
    promotion.type === selection.type &&
    (selection.promotionId === null ||
      promotion.id === selection.promotionId) &&
    (selection.offerId === null ||
      (promotion.ref_id ?? promotion.offer_id) === selection.offerId)
  );
}

function datesAreValid(
  candidate: ManagedActivePromotion,
  startDate: string,
  finishDate: string,
): boolean {
  const start = Date.parse(startDate);
  const finish = Date.parse(finishDate);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start)
    return false;
  const candidateStart = Date.parse(candidate.start_date ?? '');
  const candidateFinish = Date.parse(candidate.finish_date ?? '');
  return (
    (!Number.isFinite(candidateStart) || start >= candidateStart) &&
    (!Number.isFinite(candidateFinish) || finish <= candidateFinish)
  );
}
