import { Injectable } from '@nestjs/common';

import { mapWithConcurrency } from '../../publications/sync/publication-sync.helpers';

import {
  findRequestedCandidate,
  findConfirmedParticipation,
} from './promotion-candidate.helpers';
import type { PromotionSwitchRequest } from './promotion-manager.types';
import {
  promotionSnapshot,
  type PublicationPromotionPreview,
  type ResolvedPromotionSource,
} from './publication-promotion.types';
import { PromotionsService } from './promotions.service';

const PROMOTION_READ_TIMEOUT = { timeoutMs: 30_000 } as const;
const PREFLIGHT_CONCURRENCY = 3;

@Injectable()
export class PublicationPromotionPreflightService {
  constructor(private readonly promotionsService: PromotionsService) {}

  async preview(
    userId: string,
    source: ResolvedPromotionSource,
    request: PromotionSwitchRequest | null,
  ): Promise<PublicationPromotionPreview> {
    const items = await mapWithConcurrency(
      source.items,
      PREFLIGHT_CONCURRENCY,
      async ({ item }) => {
        const promotions = await this.promotionsService.getPromotionsStrict(
          userId,
          item.id,
          source.accessToken,
          PROMOTION_READ_TIMEOUT,
        );
        const candidate = request
          ? findRequestedCandidate(promotions.candidates, request)
          : null;
        const alreadyParticipating = request
          ? findConfirmedParticipation(promotions, request)
          : null;
        const applicable = request
          ? candidate !== null || alreadyParticipating !== null
          : [...promotions.active, ...promotions.pending].every(
              canRemovePromotion,
            );
        return {
          itemId: item.id,
          price:
            typeof item.price === 'number' && Number.isFinite(item.price)
              ? item.price
              : null,
          activePromotion: promotions.active[0]
            ? promotionSnapshot(promotions.active[0])
            : null,
          candidates: promotions.candidates.map(promotionSnapshot),
          requestedCandidate: candidate
            ? promotionSnapshot(candidate)
            : alreadyParticipating
              ? promotionSnapshot(alreadyParticipating.promotion)
              : null,
          applicable,
          unavailableReason: applicable
            ? null
            : ('PROMOTION_NOT_APPLICABLE' as const),
        };
      },
    );
    const applicableItems = items.filter((item) => item.applicable).length;
    return {
      sourceKey: source.sourceKey,
      totalItems: items.length,
      applicableItems,
      unavailableItems: items.length - applicableItems,
      items,
    };
  }
}

function canRemovePromotion(promotion: {
  id?: string | null;
  type?: string | null;
  ref_id?: string | null;
  offer_id?: string | null;
}): boolean {
  if (promotion.type === 'PRICE_DISCOUNT') return true;
  if (
    promotion.type !== 'DEAL' &&
    promotion.type !== 'SELLER_CAMPAIGN' &&
    promotion.type !== 'SMART'
  )
    return true;
  if (typeof promotion.id !== 'string' || !promotion.id.trim()) return false;
  return (
    promotion.type !== 'SMART' ||
    (typeof (promotion.ref_id ?? promotion.offer_id) === 'string' &&
      Boolean((promotion.ref_id ?? promotion.offer_id)?.trim()))
  );
}
