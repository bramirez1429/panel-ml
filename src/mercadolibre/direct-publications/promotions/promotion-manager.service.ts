import { BadRequestException, Injectable } from '@nestjs/common';

import { PublicationDetailService } from '../publications/publication-detail.service';

import { PromotionApplicationService } from './promotion-application.service';
import type {
  ManagedActivePromotion,
  PromotionManagerResult,
  PromotionSwitchRequest,
} from './promotion-manager.types';
import type { PromotionPublication } from './promotion-publication.types';
import { PromotionRemovalService } from './promotion-removal.service';
import { promotionError } from './promotion-errors';

@Injectable()
export class PromotionManagerService {
  constructor(
    private readonly publicationDetailService: PublicationDetailService,
    private readonly removalService: PromotionRemovalService,
    private readonly applicationService: PromotionApplicationService,
  ) {}

  async switchClassic(
    userId: string,
    itemId: string,
    request: PromotionSwitchRequest,
  ): Promise<PromotionManagerResult> {
    return this.switchPromotion(userId, { type: 'CLASSIC', itemId }, request);
  }

  async switchNew(
    userId: string,
    familyId: string,
    itemId: string,
    request: PromotionSwitchRequest,
  ): Promise<PromotionManagerResult> {
    return this.switchPromotion(
      userId,
      { type: 'NEW', familyId, itemId },
      request,
    );
  }

  private async switchPromotion(
    userId: string,
    publication: PromotionPublication,
    request: PromotionSwitchRequest,
  ): Promise<PromotionManagerResult> {
    const before = await this.publicationDetailService.getDetail(
      userId,
      publication.itemId,
    );
    const previousPromotion = this.getFirstActivePromotion(
      before.promotions?.active,
    );
    let removedPreviousPromotion = false;
    if (previousPromotion) {
      await this.removalService.removePromotion(
        userId,
        publication,
        previousPromotion,
      );
      removedPreviousPromotion = true;
      await this.removalService.verifyNoActive(userId, publication.itemId);
      await this.waitForNoActivePromotion(userId, publication.itemId);
    }
    await this.waitForCandidate(userId, publication.itemId, request);
    await this.activatePromotionWithRetry(userId, publication, request);
    const activePromotion = await this.waitForPromotion(
      userId,
      publication.itemId,
      request,
    );
    const verified = activePromotion !== null;
    return {
      success: verified,
      previousPromotion,
      removedPreviousPromotion,
      requestedPromotion: request.type,
      activePromotion,
      verified,
    };
  }

  private async activatePromotionWithRetry(
    userId: string,
    publication: PromotionPublication,
    request: PromotionSwitchRequest,
  ): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await this.applicationService.apply(userId, publication, request);
        return;
      } catch (error) {
        lastError = error;
        if (!this.isNoCandidatesError(error)) throw error;
        await this.delay(1000);
      }
    }
    throw lastError;
  }

  private isNoCandidatesError(error: unknown): boolean {
    const value = error as {
      message?: unknown;
      response?: unknown;
      getResponse?: () => unknown;
    };
    let response: unknown;
    try {
      response =
        typeof value?.getResponse === 'function'
          ? value.getResponse()
          : value?.response;
    } catch {
      response = undefined;
    }
    return JSON.stringify(response ?? value?.message ?? error)
      .toLowerCase()
      .includes('no candidates found');
  }

  private async waitForPromotion(
    userId: string,
    itemId: string,
    request: PromotionSwitchRequest,
  ): Promise<ManagedActivePromotion | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const detail = await this.publicationDetailService.getDetail(
        userId,
        itemId,
      );
      const active = this.getFirstActivePromotion(detail.promotions?.active);
      if (active && this.matchesRequest(active, request)) return active;
      await this.delay(1000);
    }
    return null;
  }

  private async waitForNoActivePromotion(
    userId: string,
    itemId: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const detail = await this.publicationDetailService.getDetail(
        userId,
        itemId,
      );
      if (!this.getFirstActivePromotion(detail.promotions?.active)) return;
      await this.delay(1000);
    }
    throw promotionError(
      'PROMOTION_VERIFICATION_FAILED',
      'Mercado Libre no confirmó la eliminación de la promoción',
    );
  }

  private matchesRequest(
    promotion: ManagedActivePromotion,
    request: PromotionSwitchRequest,
  ): boolean {
    if (promotion.type !== request.type) return false;
    if (request.type === 'PRICE_DISCOUNT') return true;
    if (promotion.id !== request.promotionId) return false;
    return (
      request.type !== 'SMART' ||
      (promotion.ref_id ?? promotion.offer_id) === request.offerId
    );
  }

  private getFirstActivePromotion(
    promotions: ManagedActivePromotion[] | undefined,
  ): ManagedActivePromotion | null {
    return Array.isArray(promotions) && promotions.length > 0
      ? (promotions[0] ?? null)
      : null;
  }

  private async waitForCandidate(
    userId: string,
    itemId: string,
    request: PromotionSwitchRequest,
  ): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const detail = await this.publicationDetailService.getDetail(
        userId,
        itemId,
      );
      const candidates = (detail.promotions?.candidates ??
        []) as ManagedActivePromotion[];
      const candidate = candidates.find((promotion) => {
        if (promotion.type !== request.type) return false;
        if (request.type === 'PRICE_DISCOUNT') return true;
        if (promotion.id !== request.promotionId) return false;
        return request.type !== 'SMART' || promotion.ref_id === request.offerId;
      });
      if (candidate) return;
      await this.delay(1000);
    }
    throw new BadRequestException(
      `Mercado Libre todavÃ­a no habilitÃ³ el candidato ${request.type}`,
    );
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
