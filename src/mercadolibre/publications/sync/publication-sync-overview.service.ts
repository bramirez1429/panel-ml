import { Injectable } from '@nestjs/common';
import { MercadolibreIntegrationEventsRepository } from '../../../database/repositories/mercadolibre-integration-events.repository';
import { MercadolibreSyncErrorsRepository } from '../../../database/repositories/mercadolibre-sync-errors.repository';
import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import type { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { progressPercent } from './publication-sync-job.service';

export const AUTOMATIC_SYNC_INTERVAL_MS = 96 * 60 * 60 * 1_000;

@Injectable()
export class PublicationSyncOverviewService {
  constructor(
    private readonly jobs: MercadolibreSyncJobsRepository,
    private readonly errors: MercadolibreSyncErrorsRepository,
    private readonly events: MercadolibreIntegrationEventsRepository,
    private readonly tokens: MercadolibreTokenService,
  ) {}

  async getOverview(userId: string) {
    const connection = await this.tokens.getStoredConnection(userId);
    const sellerId = connection.seller_id;
    const [active, latest, latestSuccessful, openErrorsCount, openEventsCount] =
      await Promise.all([
        this.jobs.findActiveBySellerId(sellerId),
        this.jobs.findLatestBySellerId(sellerId),
        this.jobs.findLatestBySellerId(sellerId, ['COMPLETED']),
        this.errors.countOpen(sellerId),
        this.events.countOpen(sellerId),
      ]);
    return {
      activeSync: active ? activeView(active) : null,
      latestSync: latest ? latestView(latest) : null,
      nextAutomaticSyncAt: nextAutomaticSyncAt(latestSuccessful),
      openErrorsCount,
      openIntegrationEventsCount: openEventsCount,
    };
  }
}

export function nextAutomaticSyncAt(job: MercadolibreSyncJob | null): string {
  if (!job?.finished_at) return new Date(0).toISOString();
  return new Date(
    Date.parse(job.finished_at) + AUTOMATIC_SYNC_INTERVAL_MS,
  ).toISOString();
}

function activeView(job: MercadolibreSyncJob) {
  return {
    id: job.id,
    status: job.status,
    totalItems: job.total_items,
    processedItems: job.processed_items,
    successfulItems: job.successful_items,
    failedItems: job.failed_items,
    percent: progressPercent(job.processed_items, job.total_items),
    startedAt: job.started_at,
  };
}

function latestView(job: MercadolibreSyncJob) {
  return {
    id: job.id,
    status: job.status,
    totalItems: job.total_items,
    processedItems: job.processed_items,
    successfulItems: job.successful_items,
    failedItems: job.failed_items,
    finishedAt: job.finished_at,
  };
}
