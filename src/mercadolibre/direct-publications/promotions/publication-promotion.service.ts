import { HttpStatus, Injectable } from '@nestjs/common';

import { mapWithConcurrency } from '../../publications/sync/publication-sync.helpers';

import { normalizedPromotionException } from './promotion-error-mapper';
import { promotionError } from './promotion-errors';
import type { PromotionSwitchRequest } from './promotion-manager.types';
import { PublicationPromotionExecutorService } from './publication-promotion-executor.service';
import { PublicationPromotionPreflightService } from './publication-promotion-preflight.service';
import { PublicationPromotionSourceService } from './publication-promotion-source.service';
import type {
  PublicationPromotionPreview,
  PublicationPromotionResult,
  PromotionItemResult,
  ResolvedPromotionSource,
} from './publication-promotion.types';

const WRITE_CONCURRENCY = 3;

@Injectable()
export class PublicationPromotionService {
  constructor(
    private readonly sourceService: PublicationPromotionSourceService,
    private readonly preflightService: PublicationPromotionPreflightService,
    private readonly executorService: PublicationPromotionExecutorService,
  ) {}

  async preview(
    userId: string,
    sourceKey: string,
    request: PromotionSwitchRequest,
  ): Promise<PublicationPromotionPreview> {
    try {
      const source = await this.sourceService.resolve(userId, sourceKey);
      return await this.preflightService.preview(userId, source, request);
    } catch (error) {
      throw normalizedPromotionException(
        error,
        'PROMOTION_PROVIDER_UNAVAILABLE',
      );
    }
  }

  async apply(
    userId: string,
    sourceKey: string,
    request: PromotionSwitchRequest,
  ): Promise<PublicationPromotionResult> {
    const source = await this.resolve(userId, sourceKey);
    const preview = await this.preflight(userId, source, request);
    this.assertAllApplicable(preview);
    const results = await mapWithConcurrency(
      source.items,
      WRITE_CONCURRENCY,
      (resolvedItem) =>
        this.executorService.apply({
          userId,
          accessToken: source.accessToken,
          resolvedItem,
          request,
        }),
    );
    return summarize(results);
  }

  async remove(
    userId: string,
    sourceKey: string,
  ): Promise<PublicationPromotionResult> {
    const source = await this.resolve(userId, sourceKey);
    const preview = await this.preflight(userId, source, null);
    this.assertAllApplicable(preview);
    const results = await mapWithConcurrency(
      source.items,
      WRITE_CONCURRENCY,
      (resolvedItem) =>
        this.executorService.remove(userId, source.accessToken, resolvedItem),
    );
    return summarize(results);
  }

  private async resolve(userId: string, sourceKey: string) {
    try {
      return await this.sourceService.resolve(userId, sourceKey);
    } catch (error) {
      throw normalizedPromotionException(
        error,
        'PROMOTION_PROVIDER_UNAVAILABLE',
      );
    }
  }

  private async preflight(
    userId: string,
    source: ResolvedPromotionSource,
    request: PromotionSwitchRequest | null,
  ) {
    try {
      return await this.preflightService.preview(userId, source, request);
    } catch (error) {
      throw normalizedPromotionException(
        error,
        'PROMOTION_PROVIDER_UNAVAILABLE',
      );
    }
  }

  private assertAllApplicable(preview: PublicationPromotionPreview): void {
    if (preview.unavailableItems === 0) return;
    throw promotionError(
      'PROMOTION_NOT_AVAILABLE_FOR_ALL_ITEMS',
      'La promoción no está disponible para todos los MLA',
      {
        totalItems: preview.totalItems,
        applicableItems: preview.applicableItems,
        unavailableItems: preview.unavailableItems,
      },
      HttpStatus.CONFLICT,
    );
  }
}

function summarize(results: PromotionItemResult[]): PublicationPromotionResult {
  const successfulItems = results.filter((result) => result.success).length;
  const failedItems = results.length - successfulItems;
  return {
    success: failedItems === 0,
    status: failedItems === 0 ? 'SUCCESS' : 'PARTIAL_FAILURE',
    ...(failedItems === 0
      ? {}
      : { errorCode: 'PROMOTION_PARTIAL_FAILURE' as const }),
    totalItems: results.length,
    successfulItems,
    failedItems,
    results,
  };
}
