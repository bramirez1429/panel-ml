import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { StockService } from '../stock/stock.service';
import { StockBulkErrorPolicy } from './stock-bulk-error-policy';
import { StockBulkJobRepository } from './stock-bulk-job.repository';
import type {
  StockBulkJob,
  StockBulkJobItem,
  StockBulkProcessResult,
  StockBulkTarget,
} from './stock-bulk.types';

@Injectable()
export class StockBulkJobService {
  private readonly logger = new Logger(StockBulkJobService.name);

  constructor(
    private readonly repository: StockBulkJobRepository,
    private readonly tokenService: MercadolibreTokenService,
    private readonly stockService: StockService,
    private readonly errorPolicy: StockBulkErrorPolicy,
  ) {}

  async start(userId: string, targets: readonly StockBulkTarget[]) {
    const connection = await this.tokenService.getStoredConnection(userId);
    const jobId = randomUUID();
    await this.repository.create({
      id: jobId,
      userId,
      sellerId: connection.seller_id,
      targets,
    });
    this.logger.log(`[stock-bulk] job creado job=${jobId}`);
    return { jobId, status: 'QUEUED' as const, totalItems: targets.length };
  }

  async processNext(
    userId: string,
    jobId: string,
  ): Promise<StockBulkProcessResult> {
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

    const retry = await this.processItem(userId, jobId, item);
    if (retry) return retry;
    const refreshed = await this.repository.refreshProgress(jobId);
    return { hasMore: !isTerminal(refreshed) };
  }

  async getStatus(userId: string, jobId: string) {
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
      skippedItems: job.skipped_items,
      percent:
        job.total_items === 0
          ? 100
          : Math.round((job.processed_items / job.total_items) * 100),
      ...(job.error_message ? { error: job.error_message } : {}),
      items: items.map(toResponseItem),
    };
  }

  async retryErrors(userId: string, jobId: string) {
    const connection = await this.tokenService.getStoredConnection(userId);
    const job = await this.ownedJob(jobId, userId, connection.seller_id);
    if (job.status !== 'COMPLETED_WITH_ERRORS') {
      throw new BadRequestException(
        'Solo se pueden reintentar jobs completados con errores',
      );
    }
    const retriedItems = await this.repository.retryErrors(jobId);
    return {
      jobId,
      status: retriedItems > 0 ? ('QUEUED' as const) : job.status,
      retriedItems,
    };
  }

  private async processItem(
    userId: string,
    jobId: string,
    item: StockBulkJobItem,
  ): Promise<StockBulkProcessResult | null> {
    if (!item.editable || item.old_quantity === item.new_quantity) {
      await this.repository.finishItem(item.id, {
        status: 'SKIPPED',
        result: {
          reason:
            item.old_quantity === item.new_quantity
              ? 'UNCHANGED'
              : (item.reason ?? 'TARGET_NOT_EDITABLE'),
        },
      });
      return null;
    }

    try {
      const result =
        item.model === 'USER_PRODUCT'
          ? await this.updateUserProduct(userId, item)
          : await this.updateLegacy(userId, item);
      await this.repository.finishItem(item.id, {
        status: 'SUCCESS',
        result,
      });
      return null;
    } catch (error) {
      const decision = this.errorPolicy.decide(error, item.attempt_count);
      if (decision.action === 'STOP') {
        await this.repository.failJob(jobId, item.id, decision.message);
        return { hasMore: false };
      }
      if (decision.action === 'RETRY') {
        await this.repository.retryItem(item.id, decision.message);
        await this.repository.releaseForRetry(jobId);
        return { hasMore: true, retryAfterSeconds: decision.delaySeconds };
      }
      await this.repository.finishItem(item.id, {
        status: 'ERROR',
        errorCode: 'STOCK_UPDATE_FAILED',
        errorMessage: decision.message,
      });
      return null;
    }
  }

  private updateUserProduct(userId: string, item: StockBulkJobItem) {
    return this.stockService.updateNew(
      userId,
      item.family_id as string,
      item.item_id,
      {
        quantity: item.new_quantity,
        ...(item.store_id ? { storeId: item.store_id } : {}),
        ...(item.network_node_id
          ? { networkNodeId: item.network_node_id }
          : {}),
      },
    );
  }

  private updateLegacy(userId: string, item: StockBulkJobItem) {
    return this.stockService.updateClassic(userId, item.item_id, {
      quantity: item.new_quantity,
      ...(item.variation_id ? { variationId: Number(item.variation_id) } : {}),
    });
  }

  private async ownedJob(
    jobId: string,
    userId: string,
    sellerId: number,
  ): Promise<StockBulkJob> {
    const job = await this.repository.findJob(jobId);
    if (!job) throw new NotFoundException('Job de stock masivo no encontrado');
    if (job.user_id !== userId || job.seller_id !== sellerId) {
      throw new ForbiddenException('El job pertenece a otro vendedor');
    }
    return job;
  }
}

function isTerminal(job: StockBulkJob): boolean {
  return ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(job.status);
}

function toResponseItem(item: StockBulkJobItem) {
  return {
    identifier: item.identifier,
    title: item.title,
    color: item.color,
    size: item.size,
    itemId: item.item_id,
    userProductId: item.user_product_id,
    variationId: item.variation_id,
    familyId: item.family_id,
    model: item.model,
    previousQuantity: item.old_quantity,
    requestedQuantity: item.new_quantity,
    previousStatus: item.old_status,
    status: item.status,
    result: item.result,
    errorCode: item.error_code,
    error: item.error_message,
  };
}
