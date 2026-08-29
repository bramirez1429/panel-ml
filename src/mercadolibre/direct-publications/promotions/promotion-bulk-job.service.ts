import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';

import {
  normalizePromotionError,
  promotionProviderMessage,
} from './promotion-error-mapper';
import { isPromotionErrorCode } from './promotion-errors';
import { PromotionBulkJobRepository } from './promotion-bulk-job.repository';
import type {
  PromotionBulkJob,
  PromotionBulkJobInputItem,
  PromotionBulkJobItem,
  PromotionBulkJobResponse,
  PromotionBulkProcessResult,
} from './promotion-bulk-job.types';
import { parsePromotionRequest } from './publication-promotion-request';
import { PublicationPromotionService } from './publication-promotion.service';

@Injectable()
export class PromotionBulkJobService {
  constructor(
    private readonly repository: PromotionBulkJobRepository,
    private readonly tokenService: MercadolibreTokenService,
    private readonly publicationPromotionService: PublicationPromotionService,
  ) {}

  async start(
    userId: string,
    items: PromotionBulkJobInputItem[],
  ): Promise<{ jobId: string; status: 'QUEUED'; totalItems: number }> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const jobId = randomUUID();
    await this.repository.create({
      id: jobId,
      userId,
      sellerId: connection.seller_id,
      items,
    });
    return { jobId, status: 'QUEUED', totalItems: items.length };
  }

  async processNext(
    userId: string,
    jobId: string,
  ): Promise<PromotionBulkProcessResult> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const job = await this.ownedJob(jobId, userId, connection.seller_id);
    if (isTerminal(job)) return { hasMore: false };
    if (!(await this.repository.claimJob(jobId))) {
      return { hasMore: true, retryAfterSeconds: 15 };
    }

    const item = await this.repository.claimNextItem(jobId);
    if (!item) {
      const refreshed = await this.repository.refreshProgress(jobId);
      return { hasMore: !isTerminal(refreshed) };
    }

    await this.processItem(userId, item);
    const refreshed = await this.repository.refreshProgress(jobId);
    return { hasMore: !isTerminal(refreshed) };
  }

  async getStatus(
    userId: string,
    jobId: string,
  ): Promise<PromotionBulkJobResponse> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const job = await this.ownedJob(jobId, userId, connection.seller_id);
    const items = await this.repository.listItems(jobId);
    return {
      jobId: job.id,
      status: job.status,
      totalItems: job.total_items,
      processedItems: job.processed_items,
      successfulItems: job.successful_items,
      failedItems: job.failed_items,
      items: items.map((item) => ({
        itemId: item.item_id,
        status: item.status,
        ...(isPromotionErrorCode(item.error_code)
          ? { errorCode: item.error_code }
          : {}),
        ...(item.provider_message
          ? { providerMessage: item.provider_message }
          : {}),
      })),
    };
  }

  private async processItem(
    userId: string,
    item: PromotionBulkJobItem,
  ): Promise<void> {
    try {
      const request = parsePromotionRequest(item.request);
      const result = await this.publicationPromotionService.apply(
        userId,
        `item:${item.item_id}`,
        request,
      );
      const individual = result.results[0];
      if (result.success && individual?.promotionStatus === 'pending') {
        await this.repository.finishItem(item.id, { status: 'SCHEDULED' });
        return;
      }
      if (result.success && individual?.promotionStatus === 'started') {
        await this.repository.finishItem(item.id, { status: 'ACTIVE' });
        return;
      }
      await this.repository.finishItem(item.id, {
        status: 'ERROR',
        errorCode: result.errorCode ?? 'PROMOTION_APPLICATION_FAILED',
        ...(result.providerMessage
          ? { providerMessage: result.providerMessage }
          : {}),
      });
    } catch (error) {
      const providerMessage = promotionProviderMessage(error);
      await this.repository.finishItem(item.id, {
        status: 'ERROR',
        errorCode: normalizePromotionError(
          error,
          'PROMOTION_APPLICATION_FAILED',
        ),
        ...(providerMessage ? { providerMessage } : {}),
      });
    }
  }

  private async ownedJob(
    jobId: string,
    userId: string,
    sellerId: number,
  ): Promise<PromotionBulkJob> {
    const job = await this.repository.findJob(jobId);
    if (!job) throw new NotFoundException('Job de promociones no encontrado');
    if (job.user_id !== userId || job.seller_id !== sellerId) {
      throw new ForbiddenException('El job pertenece a otro vendedor');
    }
    return job;
  }
}

function isTerminal(job: PromotionBulkJob): boolean {
  return job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_ERRORS';
}
