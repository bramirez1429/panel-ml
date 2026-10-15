import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeSourceReplicationService } from '../replication/tiendanube-source-replication.service';
import { TiendanubeMigrationDiscoveryService } from './tiendanube-migration-discovery.service';
import {
  decideMigrationError,
  safeMessage,
} from './tiendanube-migration-error-policy';
import { SupabaseTiendanubeMigrationRepository } from './supabase-tiendanube-migration.repository';
import type {
  TiendanubeMigrationItemStatus,
  TiendanubeMigrationItemsPage,
  TiendanubeMigrationJob,
  TiendanubeMigrationJobResponse,
  ClaimedTiendanubeMigrationItem,
} from './tiendanube-migration.types';

const RECONCILIATION_DELAYS = [60, 180, 600] as const;

@Injectable()
export class TiendanubeMigrationService {
  constructor(
    private readonly repository: SupabaseTiendanubeMigrationRepository,
    private readonly tokenService: MercadolibreTokenService,
    private readonly connectionRepository: TiendanubeConnectionRepository,
    private readonly discovery: TiendanubeMigrationDiscoveryService,
    private readonly replication: TiendanubeSourceReplicationService,
  ) {}

  async start(
    userId: string,
    testLimit: 1 | 5 | 10 | null = null,
  ): Promise<TiendanubeMigrationJobResponse> {
    const [mlConnection, tnConnection] = await Promise.all([
      this.tokenService.getStoredConnection(userId),
      this.connectionRepository.findOwnedCredentialsByUserId(userId),
    ]);
    if (!tnConnection?.accessToken.trim()) {
      throw new UnauthorizedException('Primero conectá Tiendanube');
    }
    const job = await this.repository.createOrGetActive({
      id: randomUUID(),
      userId,
      sellerId: mlConnection.seller_id,
      storeId: tnConnection.storeId,
      testLimit,
    });
    return toJobResponse(job);
  }

  async getActive(
    userId: string,
  ): Promise<TiendanubeMigrationJobResponse | null> {
    const { sellerId, storeId } = await this.ownerContext(userId);
    const job = await this.repository.findActive(userId, sellerId, storeId);
    return job ? toJobResponse(job) : null;
  }

  async getJob(
    userId: string,
    jobId: string,
  ): Promise<TiendanubeMigrationJobResponse> {
    return toJobResponse(await this.ownedJob(userId, jobId));
  }

  async getItems(
    userId: string,
    jobId: string,
    status: TiendanubeMigrationItemStatus,
    page: number,
    limit: number,
  ): Promise<TiendanubeMigrationItemsPage> {
    await this.ownedJob(userId, jobId);
    const result = await this.repository.listItems(jobId, status, page, limit);
    return {
      page,
      limit,
      total: result.total,
      items: result.items.map((item) => ({
        sourceKey: item.source_key,
        title: item.title,
        mlaIds: item.mla_ids,
        familyId: item.family_id,
        mlauIds: item.mlau_ids,
        status: item.status,
        outcome: item.outcome,
        tiendanubeProductId: item.tiendanube_product_id,
        errorCode: item.error_code,
        errorMessage: item.error_message,
        attempts: item.attempts,
        updatedAt: item.updated_at,
      })),
    };
  }

  async processNext(
    jobId: string,
  ): Promise<{ hasMore: boolean; delaySeconds?: number }> {
    if (
      !(await this.repository.findJob(jobId)) ||
      !(await this.repository.claimJob(jobId))
    ) {
      return { hasMore: false };
    }
    const job = await this.repository.findJob(jobId);
    if (!job) return { hasMore: false };
    if (job.status === 'DISCOVERING') return this.processDiscovery(job);

    const item = await this.repository.claimNextItem(jobId);
    if (!item) {
      await this.repository.completeEmptyJob(jobId);
      return { hasMore: false };
    }
    if (item.isReconciliation) return this.reconcile(job, item);
    return this.replicate(job, item);
  }

  private async processDiscovery(job: TiendanubeMigrationJob) {
    try {
      const connection = await this.tokenService.getStoredConnection(
        job.user_id,
      );
      const token = await this.tokenService.getValidAccessToken(
        job.user_id,
        connection,
      );
      const page = await this.discovery.discoverPage({
        sellerId: job.seller_id,
        accessToken: token,
        scrollId: job.scan_scroll_id,
        ...(job.test_limit === null
          ? {}
          : { maxProducts: Math.max(job.test_limit - job.total_items, 1) }),
      });
      await this.repository.recordDiscoveryPage({ jobId: job.id, ...page });
      return { hasMore: true };
    } catch (error) {
      const decision = decideMigrationError(error, 1);
      if (decision.kind === 'REJECT') {
        await this.repository.pauseJob(job.id, decision.message);
        return { hasMore: false };
      }
      const delaySeconds =
        decision.kind === 'RETRY' ? decision.delaySeconds : 300;
      await this.repository.retryDiscovery(
        job.id,
        delaySeconds,
        safeMessage(error),
      );
      return { hasMore: true, delaySeconds };
    }
  }

  private async replicate(
    job: TiendanubeMigrationJob,
    item: ClaimedTiendanubeMigrationItem,
  ): Promise<{ hasMore: boolean; delaySeconds?: number }> {
    let postStarted = false;
    try {
      const result = await this.replication.replicateForMigration(
        job.user_id,
        item.sourceKey,
        {
          beforeCreate: async () => {
            await this.repository.markPostStarted(item.id);
            postStarted = true;
          },
        },
      );
      if (result.action === 'review-required') {
        await this.repository.finishItem({
          itemId: item.id,
          status: 'REJECTED',
          tiendanubeProductId: result.tiendanubeProductId,
          errorCode: 'POSSIBLE_MATCH_REVIEW',
          errorMessage:
            'Existe una coincidencia por SKU sin vínculo confiable.',
        });
      } else {
        await this.repository.finishItem({
          itemId: item.id,
          status: 'APPROVED',
          tiendanubeProductId: result.tiendanubeProductId,
          outcome: result.action === 'created' ? 'CREATED' : 'ALREADY_EXISTS',
        });
      }
      return { hasMore: hasRemainingAfterTerminal(job) };
    } catch (error) {
      if (postStarted)
        return this.deferReconciliation(job, item, safeMessage(error));
      return this.handlePrePostError(job, item, error);
    }
  }

  private async reconcile(
    job: TiendanubeMigrationJob,
    item: ClaimedTiendanubeMigrationItem,
  ): Promise<{ hasMore: boolean; delaySeconds?: number }> {
    try {
      const result = await this.replication.reconcileMigration(
        job.user_id,
        item.sourceKey,
      );
      if (!result)
        return this.deferReconciliation(
          job,
          item,
          'Tiendanube aún no permite confirmar el POST.',
        );
      await this.repository.finishItem({
        itemId: item.id,
        status: 'APPROVED',
        tiendanubeProductId: result.tiendanubeProductId,
        outcome: result.action === 'created' ? 'CREATED' : 'ALREADY_EXISTS',
      });
      return { hasMore: hasRemainingAfterTerminal(job) };
    } catch (error) {
      return this.deferReconciliation(job, item, safeMessage(error));
    }
  }

  private async deferReconciliation(
    job: TiendanubeMigrationJob,
    item: { id: string; attempts: number },
    message: string,
  ) {
    if (item.attempts >= RECONCILIATION_DELAYS.length + 1) {
      await this.repository.pauseJob(
        job.id,
        `No se pudo reconciliar ${item.id}: ${message}`,
      );
      return { hasMore: false };
    }
    const delaySeconds =
      RECONCILIATION_DELAYS[Math.max(item.attempts - 1, 0)] ?? 600;
    await this.repository.waitForReconciliation(item.id, delaySeconds, message);
    return { hasMore: true, delaySeconds };
  }

  private async handlePrePostError(
    job: TiendanubeMigrationJob,
    item: { id: string; attempts: number },
    error: unknown,
  ) {
    const decision = decideMigrationError(error, item.attempts);
    if (decision.kind === 'REJECT') {
      await this.repository.finishItem({
        itemId: item.id,
        status: 'REJECTED',
        errorCode: decision.code,
        errorMessage: decision.message,
      });
      return { hasMore: hasRemainingAfterTerminal(job) };
    }
    if (decision.kind === 'PAUSE') {
      await this.repository.pauseJob(job.id, decision.message);
      return { hasMore: false };
    }
    await this.repository.retryItem(
      item.id,
      decision.delaySeconds,
      decision.message,
    );
    return { hasMore: true, delaySeconds: decision.delaySeconds };
  }

  private async ownedJob(
    userId: string,
    jobId: string,
  ): Promise<TiendanubeMigrationJob> {
    const job = await this.repository.findJob(jobId);
    if (!job)
      throw new NotFoundException('Migración de Tiendanube no encontrada');
    const { sellerId, storeId } = await this.ownerContext(userId);
    if (
      job.user_id !== userId ||
      job.seller_id !== sellerId ||
      job.store_id !== storeId
    ) {
      throw new ForbiddenException(
        'La migración pertenece a otro usuario o tienda',
      );
    }
    return job;
  }

  private async ownerContext(
    userId: string,
  ): Promise<{ sellerId: number; storeId: string }> {
    const [ml, tn] = await Promise.all([
      this.tokenService.getStoredConnection(userId),
      this.connectionRepository.findOwnedCredentialsByUserId(userId),
    ]);
    if (!tn?.accessToken.trim())
      throw new UnauthorizedException('Primero conectá Tiendanube');
    return { sellerId: ml.seller_id, storeId: tn.storeId };
  }
}

function hasRemainingAfterTerminal(job: TiendanubeMigrationJob): boolean {
  return job.processed_items + 1 < job.total_items;
}

function toJobResponse(
  job: TiendanubeMigrationJob,
): TiendanubeMigrationJobResponse {
  return {
    id: job.id,
    status: job.status,
    totalItems: job.total_items,
    processedItems: job.processed_items,
    approvedItems: job.approved_items,
    rejectedItems: job.rejected_items,
    currentSourceKey: job.current_source_key,
    testLimit: job.test_limit,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    finishedAt: job.finished_at,
  };
}
