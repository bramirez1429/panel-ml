import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SyncErrorRow } from '../../../database/database.types';
import { MercadolibreSyncErrorsRepository } from '../../../database/repositories/mercadolibre-sync-errors.repository';
import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { mapWithConcurrency } from './publication-sync.helpers';
import { classifySyncError } from './publication-sync-error-classifier';
import { PublicationSyncService } from './publication-sync.service';

const RETRY_CONCURRENCY = 4;

@Injectable()
export class PublicationSyncRetryService {
  constructor(
    private readonly jobs: MercadolibreSyncJobsRepository,
    private readonly errors: MercadolibreSyncErrorsRepository,
    private readonly tokens: MercadolibreTokenService,
    private readonly sync: PublicationSyncService,
  ) {}

  async listOpen(userId: string, syncId: string) {
    const { job } = await this.context(userId, syncId);
    return this.errors.findOpen(job.seller_id, job.id);
  }

  async retryOne(userId: string, syncId: string, errorId: string) {
    return this.retrySelected(userId, syncId, [errorId]);
  }

  async retrySelected(userId: string, syncId: string, errorIds: string[]) {
    const context = await this.context(userId, syncId);
    const errors = await this.errors.findOpenByIds(context.job.seller_id, [
      ...new Set(errorIds),
    ]);
    return this.retryErrors(context, errors);
  }

  async retryAll(userId: string, syncId: string) {
    const context = await this.context(userId, syncId);
    const errors = await this.errors.findOpen(
      context.job.seller_id,
      context.job.id,
    );
    return this.retryErrors(context, errors);
  }

  private async retryErrors(
    context: Awaited<ReturnType<PublicationSyncRetryService['context']>>,
    candidates: SyncErrorRow[],
  ) {
    const errors = candidates.filter(
      ({ sync_job_id }) => sync_job_id === context.job.id,
    );
    if (errors.length === 0) {
      return {
        syncId: context.job.id,
        retriedItems: 0,
        resolvedItems: 0,
        openErrorsCount: await this.errors.countOpen(
          context.job.seller_id,
          context.job.id,
        ),
      };
    }
    const accessToken = await this.tokens.getValidAccessToken(
      context.connection.user_id,
      context.connection,
    );
    const groups = groupByItem(errors);
    const outcomes = await mapWithConcurrency(
      [...groups.values()],
      RETRY_CONCURRENCY,
      async (group) => {
        for (const error of group) await this.errors.markRetrying(error);
        try {
          const result = await this.sync.syncBatch(
            [group[0].item_id],
            { sellerId: context.job.seller_id, accessToken },
            context.job.full_sync_id,
          );
          if (result.errors.length > 0) {
            const retryError = result.errors[0];
            for (const error of group) {
              await this.errors.reopen(
                error.id,
                retryError.message,
                retryError.type,
              );
            }
            return false;
          }
          for (const error of group) await this.errors.resolve(error.id);
          await this.jobs.resolveRetriedItem(context.job.id, group.length);
          return true;
        } catch (error) {
          const classified = classifySyncError(error);
          for (const stored of group) {
            await this.errors.reopen(
              stored.id,
              classified.message,
              classified.type,
            );
          }
          throw error;
        }
      },
    );

    const openCount = await this.errors.countOpen(
      context.job.seller_id,
      context.job.id,
    );
    if (openCount === 0 && context.job.started_at) {
      await this.sync.finalizeFullSync(
        context.job.seller_id,
        context.job.full_sync_id,
        context.job.started_at,
      );
      await this.jobs.completeAfterRetries(context.job.id);
    }
    return {
      syncId: context.job.id,
      retriedItems: outcomes.length,
      resolvedItems: outcomes.filter(Boolean).length,
      openErrorsCount: openCount,
    };
  }

  private async context(userId: string, syncId: string) {
    const connection = await this.tokens.getStoredConnection(userId);
    const job = await this.jobs.findById(syncId);
    if (!job) throw new NotFoundException('Sincronización no encontrada');
    if (job.seller_id !== connection.seller_id) {
      throw new ForbiddenException(
        'La sincronización pertenece a otro vendedor',
      );
    }
    return { connection, job };
  }
}

function groupByItem(errors: SyncErrorRow[]): Map<string, SyncErrorRow[]> {
  const groups = new Map<string, SyncErrorRow[]>();
  for (const error of errors) {
    const current = groups.get(error.item_id) ?? [];
    current.push(error);
    groups.set(error.item_id, current);
  }
  return groups;
}
