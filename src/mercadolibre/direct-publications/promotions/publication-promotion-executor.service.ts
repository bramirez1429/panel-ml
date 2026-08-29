import { Injectable } from '@nestjs/common';

import { PromotionApplicationService } from './promotion-application.service';
import {
  findRequestedCandidate,
  promotionMatchesRequest,
  samePromotion,
} from './promotion-candidate.helpers';
import {
  normalizePromotionError,
  isTimeout,
  promotionProviderMessage,
} from './promotion-error-mapper';
import { promotionError } from './promotion-errors';
import type { ManagedActivePromotion } from './promotion-manager.types';
import type {
  PromotionExecutionContext,
  PromotionExecutionStage,
  PromotionItemResult,
  ResolvedPromotionItem,
} from './publication-promotion.types';
import { PromotionRemovalService } from './promotion-removal.service';
import { PromotionsService } from './promotions.service';

const PROMOTION_TIMEOUT = { timeoutMs: 30_000 } as const;
const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 10;

@Injectable()
export class PublicationPromotionExecutorService {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly removalService: PromotionRemovalService,
    private readonly applicationService: PromotionApplicationService,
  ) {}

  async apply(
    context: PromotionExecutionContext,
  ): Promise<PromotionItemResult> {
    const itemId = context.resolvedItem.item.id;
    let stage: PromotionExecutionStage = 'CURRENT_STATE';
    try {
      let current = await this.current(
        context.userId,
        itemId,
        context.accessToken,
      );
      const candidate = findRequestedCandidate(
        current.candidates,
        context.request,
      );
      if (!candidate) {
        throw promotionError(
          'PROMOTION_CHANGED_DURING_OPERATION',
          'La candidate cambió durante la operación',
        );
      }
      const alreadyActive = current.active.some((promotion) =>
        promotionMatchesRequest(promotion, context.request),
      );
      const previous = current.active.filter(
        (promotion) => !promotionMatchesRequest(promotion, context.request),
      );
      if (previous.length > 0) {
        stage = 'REMOVAL';
        for (const promotion of previous) {
          await this.removeSafely(context, promotion);
        }
        stage = 'REMOVAL_VERIFICATION';
        await this.waitUntil(
          context.userId,
          itemId,
          context.accessToken,
          (promotions) =>
            previous.every((removed) =>
              promotions.active.every(
                (active) => !samePromotion(active, removed),
              ),
            ),
        );
      }
      if (alreadyActive) {
        return { itemId, success: true, stage: 'COMPLETED' };
      }
      stage = 'CANDIDATE_REVALIDATION';
      current = await this.current(context.userId, itemId, context.accessToken);
      if (!findRequestedCandidate(current.candidates, context.request)) {
        throw promotionError(
          'PROMOTION_CHANGED_DURING_OPERATION',
          'La candidate dejó de estar disponible',
        );
      }
      stage = 'APPLICATION';
      await this.applySafely(context);
      stage = 'APPLICATION_VERIFICATION';
      await this.waitUntil(
        context.userId,
        itemId,
        context.accessToken,
        (promotions) =>
          promotions.active.some((promotion) =>
            promotionMatchesRequest(promotion, context.request),
          ),
      );
      return { itemId, success: true, stage: 'COMPLETED' };
    } catch (error) {
      const providerMessage = promotionProviderMessage(error);
      return {
        itemId,
        success: false,
        stage,
        errorCode: normalizePromotionError(error, fallbackForStage(stage)),
        ...(providerMessage ? { providerMessage } : {}),
      };
    }
  }

  async remove(
    userId: string,
    accessToken: string,
    resolvedItem: ResolvedPromotionItem,
  ): Promise<PromotionItemResult> {
    const itemId = resolvedItem.item.id;
    let stage: PromotionExecutionStage = 'CURRENT_STATE';
    try {
      const current = await this.current(userId, itemId, accessToken);
      if (current.active.length === 0) {
        return { itemId, success: true, stage: 'ALREADY_INACTIVE' };
      }
      stage = 'REMOVAL';
      const context = { userId, accessToken, resolvedItem };
      for (const promotion of current.active) {
        await this.removeSafely(context, promotion);
      }
      stage = 'REMOVAL_VERIFICATION';
      await this.waitUntil(
        userId,
        itemId,
        accessToken,
        (promotions) => promotions.active.length === 0,
      );
      return { itemId, success: true, stage: 'COMPLETED' };
    } catch (error) {
      const providerMessage = promotionProviderMessage(error);
      return {
        itemId,
        success: false,
        stage,
        errorCode: normalizePromotionError(error, fallbackForStage(stage)),
        ...(providerMessage ? { providerMessage } : {}),
      };
    }
  }

  private async removeSafely(
    context: Pick<
      PromotionExecutionContext,
      'userId' | 'accessToken' | 'resolvedItem'
    >,
    promotion: ManagedActivePromotion,
  ): Promise<void> {
    try {
      await this.removalService.removePromotion(
        context.userId,
        context.resolvedItem.publication,
        promotion,
        PROMOTION_TIMEOUT,
      );
    } catch (error) {
      if (!isTimeout(error)) throw error;
      const state = await this.current(
        context.userId,
        context.resolvedItem.item.id,
        context.accessToken,
      );
      if (state.active.every((active) => !samePromotion(active, promotion)))
        return;
      throw promotionError(
        'PROMOTION_TIMEOUT',
        'La eliminación agotó el tiempo y no pudo confirmarse',
      );
    }
  }

  private async applySafely(context: PromotionExecutionContext): Promise<void> {
    try {
      await this.applicationService.apply(
        context.userId,
        context.resolvedItem.publication,
        context.request,
        PROMOTION_TIMEOUT,
      );
    } catch (error) {
      if (!isTimeout(error)) throw error;
      const state = await this.current(
        context.userId,
        context.resolvedItem.item.id,
        context.accessToken,
      );
      if (
        state.active.some((active) =>
          promotionMatchesRequest(active, context.request),
        )
      )
        return;
      throw promotionError(
        'PROMOTION_TIMEOUT',
        'La aplicación agotó el tiempo y no pudo confirmarse',
      );
    }
  }

  private current(userId: string, itemId: string, accessToken: string) {
    return this.promotionsService.getPromotionsStrict(
      userId,
      itemId,
      accessToken,
      PROMOTION_TIMEOUT,
    );
  }

  private async waitUntil(
    userId: string,
    itemId: string,
    accessToken: string,
    predicate: (
      state: Awaited<ReturnType<PromotionsService['getPromotionsStrict']>>,
    ) => boolean,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const state = await this.current(userId, itemId, accessToken);
      if (predicate(state)) return;
      if (attempt < MAX_POLL_ATTEMPTS - 1) await delay(POLL_INTERVAL_MS);
    }
    throw promotionError(
      'PROMOTION_VERIFICATION_FAILED',
      'Mercado Libre no confirmó el estado final de la promoción',
    );
  }
}

function fallbackForStage(stage: PromotionExecutionStage) {
  if (stage === 'REMOVAL') return 'PROMOTION_REMOVAL_FAILED' as const;
  if (stage === 'APPLICATION') return 'PROMOTION_APPLICATION_FAILED' as const;
  if (stage.endsWith('VERIFICATION'))
    return 'PROMOTION_VERIFICATION_FAILED' as const;
  return 'PROMOTION_CHANGED_DURING_OPERATION' as const;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
