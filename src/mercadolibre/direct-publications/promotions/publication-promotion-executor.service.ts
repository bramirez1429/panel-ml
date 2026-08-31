import { HttpException, Injectable, Logger } from '@nestjs/common';

import { PromotionApplicationService } from './promotion-application.service';
import {
  findRequestedCandidate,
  findConfirmedParticipation,
  promotionMatchesRemoval,
  promotionMatchesRequest,
  samePromotion,
} from './promotion-candidate.helpers';
import {
  normalizePromotionError,
  isTimeout,
  promotionProviderMessage,
  promotionProviderStatus,
} from './promotion-error-mapper';
import { promotionError } from './promotion-errors';
import type { ManagedActivePromotion } from './promotion-manager.types';
import type {
  PromotionExecutionContext,
  PromotionExecutionStage,
  PromotionItemResult,
  PromotionRemovalSelection,
  ResolvedPromotionItem,
} from './publication-promotion.types';
import { PromotionRemovalService } from './promotion-removal.service';
import { PromotionsService } from './promotions.service';

const PROMOTION_TIMEOUT = { timeoutMs: 30_000 } as const;
const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 10;
const UNCERTAIN_WRITE_RETRY_DELAYS_MS = [300, 600, 1_000, 1_500] as const;
const UNCERTAIN_REMOVAL_RETRY_DELAYS_MS = [0, 300, 600, 1_000, 1_500] as const;

@Injectable()
export class PublicationPromotionExecutorService {
  private readonly logger = new Logger(
    PublicationPromotionExecutorService.name,
  );

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
      const existingParticipation = findConfirmedParticipation(
        current,
        context.request,
      );
      if (existingParticipation) {
        return {
          itemId,
          success: true,
          stage: 'COMPLETED',
          promotionStatus: existingParticipation.status,
        };
      }
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
      stage = 'CANDIDATE_REVALIDATION';
      current = await this.current(context.userId, itemId, context.accessToken);
      const concurrentParticipation = findConfirmedParticipation(
        current,
        context.request,
      );
      if (concurrentParticipation) {
        return {
          itemId,
          success: true,
          stage: 'COMPLETED',
          promotionStatus: concurrentParticipation.status,
        };
      }
      if (!findRequestedCandidate(current.candidates, context.request)) {
        throw promotionError(
          'PROMOTION_CHANGED_DURING_OPERATION',
          'La candidate dejó de estar disponible',
        );
      }
      stage = 'APPLICATION';
      const reconciledStatus = await this.applySafely(context);
      const diagnosticStatus =
        reconciledStatus ?? (await this.readParticipation(context));
      return {
        itemId,
        success: true,
        stage: 'COMPLETED',
        ...(diagnosticStatus ? { promotionStatus: diagnosticStatus } : {}),
      };
    } catch (error) {
      const providerMessage = promotionProviderMessage(error);
      const providerStatus = promotionProviderStatus(error);
      return {
        itemId,
        success: false,
        stage,
        errorCode: normalizePromotionError(error, fallbackForStage(stage)),
        ...(providerMessage ? { providerMessage } : {}),
        ...(providerStatus ? { providerStatus } : {}),
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
      const removable = uniquePromotions([
        ...current.active,
        ...current.pending,
      ]);
      if (removable.length === 0) {
        return { itemId, success: true, stage: 'ALREADY_INACTIVE' };
      }
      stage = 'REMOVAL';
      const context = { userId, accessToken, resolvedItem };
      for (const promotion of removable) {
        await this.removeSafely(context, promotion);
      }
      stage = 'REMOVAL_VERIFICATION';
      await this.waitUntil(
        userId,
        itemId,
        accessToken,
        (promotions) =>
          promotions.active.length === 0 && promotions.pending.length === 0,
      );
      return { itemId, success: true, stage: 'COMPLETED' };
    } catch (error) {
      const providerMessage = promotionProviderMessage(error);
      const providerStatus = promotionProviderStatus(error);
      return {
        itemId,
        success: false,
        stage,
        errorCode: normalizePromotionError(error, fallbackForStage(stage)),
        ...(providerMessage ? { providerMessage } : {}),
        ...(providerStatus ? { providerStatus } : {}),
      };
    }
  }

  async removeSelected(
    userId: string,
    accessToken: string,
    resolvedItem: ResolvedPromotionItem,
    selection: PromotionRemovalSelection,
  ): Promise<PromotionItemResult> {
    const itemId = resolvedItem.item.id;
    let stage: PromotionExecutionStage = 'CURRENT_STATE';
    try {
      const current = await this.current(userId, itemId, accessToken);
      const selected = [...current.active, ...current.pending].find(
        (promotion) => promotionMatchesRemoval(promotion, selection),
      );
      if (!selected) {
        return { itemId, success: true, stage: 'ALREADY_INACTIVE' };
      }
      stage = 'REMOVAL';
      const reconciled = await this.removeSafely(
        { userId, accessToken, resolvedItem },
        selected,
      );
      if (reconciled) {
        return { itemId, success: true, stage: 'COMPLETED' };
      }
      stage = 'REMOVAL_VERIFICATION';
      await this.waitUntil(userId, itemId, accessToken, (promotions) =>
        [...promotions.active, ...promotions.pending].every(
          (promotion) => !promotionMatchesRemoval(promotion, selection),
        ),
      );
      return { itemId, success: true, stage: 'COMPLETED' };
    } catch (error) {
      const providerMessage = promotionProviderMessage(error);
      const providerStatus = promotionProviderStatus(error);
      const errorCode =
        stage === 'REMOVAL' && isServerError(error)
          ? 'PROMOTION_REMOVAL_FAILED'
          : normalizePromotionError(error, fallbackForStage(stage));
      return {
        itemId,
        success: false,
        stage,
        errorCode,
        ...(providerMessage ? { providerMessage } : {}),
        ...(providerStatus ? { providerStatus } : {}),
      };
    }
  }

  private async removeSafely(
    context: Pick<
      PromotionExecutionContext,
      'userId' | 'accessToken' | 'resolvedItem'
    >,
    promotion: ManagedActivePromotion,
  ): Promise<boolean> {
    try {
      await this.removalService.removePromotion(
        context.userId,
        context.resolvedItem.publication,
        promotion,
        PROMOTION_TIMEOUT,
      );
      return false;
    } catch (error) {
      if (!isUncertainWrite(error)) throw error;
      this.logUncertainRemoval(context.resolvedItem.item.id, promotion, error);
      if (await this.reconcileUncertainRemoval(context, promotion)) return true;
      throw error;
    }
  }

  private async reconcileUncertainRemoval(
    context: Pick<
      PromotionExecutionContext,
      'userId' | 'accessToken' | 'resolvedItem'
    >,
    promotion: ManagedActivePromotion,
  ): Promise<boolean> {
    const selection = removalSelectionFor(promotion);
    for (const delayMs of UNCERTAIN_REMOVAL_RETRY_DELAYS_MS) {
      if (delayMs > 0) await delay(delayMs);
      try {
        const state = await this.current(
          context.userId,
          context.resolvedItem.item.id,
          context.accessToken,
        );
        const remains = [...state.active, ...state.pending].some((current) =>
          selection
            ? promotionMatchesRemoval(current, selection)
            : samePromotion(current, promotion),
        );
        if (!remains) return true;
      } catch {
        // La lectura también puede ser eventual; se conserva el error del DELETE.
      }
    }
    return false;
  }

  private logUncertainRemoval(
    itemId: string,
    promotion: ManagedActivePromotion,
    error: unknown,
  ): void {
    this.logger.warn({
      operation: 'promotion.remove',
      itemId,
      promotionType: promotion.type,
      promotionId: promotion.id ?? null,
      httpStatus: promotionProviderStatus(error) ?? null,
      providerMessage: promotionProviderMessage(error) ?? null,
    });
  }

  private async applySafely(
    context: PromotionExecutionContext,
  ): Promise<'pending' | 'started' | null> {
    try {
      await this.applicationService.apply(
        context.userId,
        context.resolvedItem.publication,
        context.request,
        PROMOTION_TIMEOUT,
      );
      return null;
    } catch (error) {
      if (!isUncertainWrite(error)) throw error;
      const confirmed = await this.reconcileUncertainWrite(context);
      if (confirmed) return confirmed;
      throw error;
    }
  }

  private async readParticipation(
    context: PromotionExecutionContext,
  ): Promise<'pending' | 'started' | null> {
    try {
      const state = await this.current(
        context.userId,
        context.resolvedItem.item.id,
        context.accessToken,
      );
      return findConfirmedParticipation(state, context.request)?.status ?? null;
    } catch {
      return null;
    }
  }

  private async reconcileUncertainWrite(
    context: PromotionExecutionContext,
  ): Promise<'pending' | 'started' | null> {
    for (const delayMs of UNCERTAIN_WRITE_RETRY_DELAYS_MS) {
      await delay(delayMs);
      const confirmed = await this.readParticipation(context);
      if (confirmed) return confirmed;
    }
    return null;
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
  ): Promise<Awaited<ReturnType<PromotionsService['getPromotionsStrict']>>> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      const state = await this.current(userId, itemId, accessToken);
      if (predicate(state)) return state;
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

function uniquePromotions(
  promotions: ManagedActivePromotion[],
): ManagedActivePromotion[] {
  return promotions.filter(
    (promotion, index) =>
      promotions.findIndex((candidate) =>
        samePromotion(candidate, promotion),
      ) === index,
  );
}

function removalSelectionFor(
  promotion: ManagedActivePromotion,
): PromotionRemovalSelection | null {
  if (typeof promotion.type !== 'string' || !promotion.type.trim()) return null;
  const promotionId =
    typeof promotion.id === 'string' && promotion.id.trim()
      ? promotion.id
      : null;
  const offerId = promotion.ref_id ?? promotion.offer_id ?? null;
  if (promotion.type !== 'PRICE_DISCOUNT' && !promotionId) return null;
  if (promotion.type === 'SMART' && !offerId) return null;
  return {
    type: promotion.type,
    promotionId: promotion.type === 'PRICE_DISCOUNT' ? null : promotionId,
    offerId: promotion.type === 'SMART' ? offerId : null,
  };
}

function isUncertainWrite(error: unknown): boolean {
  return (
    isTimeout(error) ||
    (error instanceof HttpException && error.getStatus() >= 500)
  );
}

function isServerError(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() >= 500;
}
