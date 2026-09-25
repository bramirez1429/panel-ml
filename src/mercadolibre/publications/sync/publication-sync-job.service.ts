import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import { MercadolibreSyncErrorsRepository } from '../../../database/repositories/mercadolibre-sync-errors.repository';
import { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PUBLICATION_SYNC_BATCH_SIZE } from '../publication.constants';
import {
  CompletionPersistenceError,
  isRetryableSyncError,
  safeSyncErrorLabel,
  safeSyncErrorMessage,
} from './publication-sync-job-error.helpers';
import {
  SyncJobCompletedResponse,
  SyncJobNextResponse,
  SyncJobPendingResponse,
  SyncJobScanState,
  SyncJobStartResponse,
  SyncJobStatusResponse,
} from './publication-sync-job.types';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncService } from './publication-sync.service';
import { SyncAccess } from './publication-sync.types';
import { classifySyncError } from './publication-sync-error-classifier';
import { PublicationIntegrationEventService } from './publication-integration-event.service';
const MAX_CONSECUTIVE_RETRIES = 3;
@Injectable()
export class PublicationSyncJobService {
  private readonly logger = new Logger(PublicationSyncJobService.name);

  /** Recibe persistencia, acceso y sincronización existentes. */
  constructor(
    private readonly jobsRepository: MercadolibreSyncJobsRepository,
    private readonly tokenService: MercadolibreTokenService,
    private readonly sourceService: PublicationSourceService,
    private readonly syncService: PublicationSyncService,
    private readonly syncErrors: MercadolibreSyncErrorsRepository,
    private readonly integrationEvents: PublicationIntegrationEventService,
  ) {}

  /** Crea una sincronización sin procesar publicaciones todavía. */
  async start(userId: string): Promise<SyncJobStartResponse> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const active = await this.jobsRepository.findActiveBySellerId(
      connection.seller_id,
    );
    if (active) {
      return {
        ok: true,
        syncId: active.id,
        status: active.status as 'PENDING' | 'RUNNING',
        created: false,
      };
    }

    const accessToken = await this.tokenService.getValidAccessToken(
      connection.user_id,
      connection,
    );
    const totalItems = await this.sourceService.getTotalItemCount(
      connection.seller_id,
      accessToken,
    );
    try {
      const job = await this.jobsRepository.create({
        id: randomUUID(),
        sellerId: connection.seller_id,
        fullSyncId: randomUUID(),
        totalItems,
      });
      return {
        ok: true,
        syncId: job.id,
        status: 'PENDING',
        created: true,
      };
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const raced = await this.jobsRepository.findActiveBySellerId(
        connection.seller_id,
      );
      if (!raced) throw error;
      return {
        ok: true,
        syncId: raced.id,
        status: raced.status as 'PENDING' | 'RUNNING',
        created: false,
      };
    }
  }

  /** Procesa el siguiente bloque del trabajo. */
  async processNext(
    userId: string,
    syncId: string,
  ): Promise<SyncJobNextResponse> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const existing = await this.findOwnedJob(syncId, connection.seller_id);
    if (
      existing.status === 'COMPLETED' ||
      existing.status === 'COMPLETED_WITH_ERRORS'
    ) {
      return this.completedResponse(existing.id, existing.status);
    }
    if (existing.status === 'FAILED') {
      throw new ConflictException('La sincronización finalizó con error');
    }

    const job = await this.jobsRepository.claim(
      existing.id,
      existing.started_at,
    );
    try {
      const access: SyncAccess = {
        sellerId: connection.seller_id,
        accessToken: await this.tokenService.getValidAccessToken(
          userId,
          connection,
        ),
      };
      return await this.processClaimedJob(job, access);
    } catch (error) {
      return this.handleClaimedError(job, error);
    }
  }

  /** Devuelve el estado acumulado sin exponer datos internos. */
  async getStatus(
    userId: string,
    syncId: string,
  ): Promise<SyncJobStatusResponse> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const job = await this.findOwnedJob(syncId, connection.seller_id);
    return {
      ok: true,
      syncId: job.id,
      status: job.status,
      totalItems: job.total_items,
      processedItems: job.processed_items,
      successfulItems: job.successful_items,
      failedItems: job.failed_items,
      percent: progressPercent(job.processed_items, job.total_items),
      productsSaved: job.products_saved,
      childrenSaved: job.children_saved,
      errorsCount: job.errors_count,
      lastError: job.last_error,
      hasMore: job.status === 'PENDING' || job.status === 'RUNNING',
    };
  }

  /** Procesa el buffer reclamado o completa un scan terminado. */
  private async processClaimedJob(
    job: MercadolibreSyncJob,
    access: SyncAccess,
  ): Promise<SyncJobNextResponse> {
    const scan = await this.ensureBuffer(job, access);
    if (scan.bufferItemIds.length === 0) {
      return this.finishJob(job, access.sellerId);
    }

    const batchIds = scan.bufferItemIds.slice(0, PUBLICATION_SYNC_BATCH_SIZE);
    const result = await this.syncService.syncBatch(
      batchIds,
      access,
      job.full_sync_id,
    );
    await this.persistIndividualErrors(job, access.sellerId, result.errors);
    const failedThisBatch = countFailedItems(batchIds, result.errors);
    const successfulThisBatch = batchIds.length - failedThisBatch;
    const updated = await this.jobsRepository.updateProgress(job.id, {
      scanStarted: scan.scanStarted,
      scrollId: scan.scrollId,
      bufferItemIds: scan.bufferItemIds.slice(PUBLICATION_SYNC_BATCH_SIZE),
      processedItems: job.processed_items + batchIds.length,
      successfulItems: job.successful_items + successfulThisBatch,
      failedItems: job.failed_items + failedThisBatch,
      productsSaved: job.products_saved + result.productsSaved,
      childrenSaved: job.children_saved + result.childrenSaved,
      errorsCount: job.errors_count + result.errors.length,
    });
    return this.pendingResponse(updated, batchIds.length);
  }

  /** Obtiene otra página del scan cuando el buffer está vacío. */
  private async ensureBuffer(
    job: MercadolibreSyncJob,
    access: SyncAccess,
  ): Promise<SyncJobScanState> {
    if (job.buffer_item_ids.length > 0) {
      return {
        scanStarted: job.scan_started,
        scrollId: job.scroll_id,
        bufferItemIds: job.buffer_item_ids,
      };
    }
    if (job.scan_started && !job.scroll_id) {
      return { scanStarted: true, scrollId: null, bufferItemIds: [] };
    }

    const page = await this.sourceService.fetchNextScanPage(
      access.sellerId,
      access.accessToken,
      job.scan_started ? (job.scroll_id ?? undefined) : undefined,
    );
    return {
      scanStarted: true,
      scrollId: page.scrollId,
      bufferItemIds: page.itemIds,
    };
  }

  /** Limpia ausentes y marca el trabajo como completado. */
  private async finishJob(
    job: MercadolibreSyncJob,
    sellerId: number,
  ): Promise<SyncJobCompletedResponse> {
    if (!job.started_at) {
      throw new ServiceUnavailableException(
        'No se pudo finalizar la sincronización de Mercado Libre',
      );
    }
    const status = job.failed_items > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
    if (status === 'COMPLETED') {
      await this.syncService.finalizeFullSync(
        sellerId,
        job.full_sync_id,
        job.started_at,
      );
    }
    try {
      const completed = await this.jobsRepository.complete(job.id, status);
      return this.completedResponse(completed.id, status);
    } catch (error) {
      throw new CompletionPersistenceError(error);
    }
  }

  /** Busca un trabajo y verifica que pertenezca al seller actual. */
  private async findOwnedJob(
    syncId: string,
    sellerId: number,
  ): Promise<MercadolibreSyncJob> {
    const job = await this.jobsRepository.findById(syncId);
    if (!job) throw new NotFoundException('Sincronización no encontrada');
    if (job.seller_id !== sellerId) {
      throw new ForbiddenException(
        'La sincronización pertenece a otro vendedor',
      );
    }
    return job;
  }

  /** Persiste el error y decide si todavía admite otro intento. */
  private async handleClaimedError(
    job: MercadolibreSyncJob,
    error: unknown,
  ): Promise<never> {
    this.logSyncError(job.id, error);
    if (error instanceof CompletionPersistenceError) throw error.originalError;

    const classified = classifySyncError(error);
    if (classified.type === 'POSSIBLE_API_CHANGE') {
      await this.integrationEvents.recordPossibleChange(
        job.seller_id,
        'publication-sync',
        classified,
      );
    }

    const safeMessage = safeSyncErrorMessage(error);
    if (!isRetryableSyncError(error)) {
      await this.jobsRepository.fail(job.id, safeMessage);
      throw error;
    }

    const retryCount = job.retry_count + 1;
    if (retryCount > MAX_CONSECUTIVE_RETRIES) {
      await this.jobsRepository.fail(job.id, safeMessage);
    } else {
      await this.jobsRepository.releaseAfterError(
        job.id,
        safeMessage,
        retryCount,
      );
    }
    throw error;
  }

  /** Construye la respuesta de un bloque pendiente. */
  private pendingResponse(
    job: MercadolibreSyncJob,
    processedThisBatch: number,
  ): SyncJobPendingResponse {
    return {
      ok: true,
      syncId: job.id,
      status: 'PENDING',
      processedThisBatch,
      processedItems: job.processed_items,
      totalItems: job.total_items,
      successfulItems: job.successful_items,
      failedItems: job.failed_items,
      percent: progressPercent(job.processed_items, job.total_items),
      productsSaved: job.products_saved,
      childrenSaved: job.children_saved,
      errorsCount: job.errors_count,
      hasMore: true,
    };
  }

  /** Construye la respuesta de un trabajo completado. */
  private completedResponse(
    syncId: string,
    status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS',
  ): SyncJobCompletedResponse {
    return { ok: true, syncId, status, hasMore: false };
  }

  private async persistIndividualErrors(
    job: MercadolibreSyncJob,
    sellerId: number,
    errors: import('./publication-sync.types').PublicationSyncError[],
  ): Promise<void> {
    await this.syncErrors.createMany(
      errors.map((error) => ({
        sync_job_id: job.id,
        seller_id: sellerId,
        item_id: error.itemId,
        family_id: error.familyId ?? null,
        error_type: error.type,
        error_code: error.code ?? null,
        error_message: error.message.slice(0, 500),
      })),
    );
    for (const error of errors) {
      if (error.type !== 'POSSIBLE_API_CHANGE') continue;
      await this.integrationEvents.recordPossibleChange(
        sellerId,
        `/items/${error.itemId}`,
        {
          type: error.type,
          code: error.code ?? null,
          message: error.message,
          httpStatus: null,
        },
        { itemId: error.itemId },
      );
    }
  }

  /** Registra el error sin incluir mensajes ni credenciales. */
  private logSyncError(syncId: string, error: unknown): void {
    this.logger.error(
      `Falló sincronización ${syncId}`,
      safeSyncErrorLabel(error),
    );
  }
}

export function progressPercent(processed: number, total: number): number {
  if (total <= 0) return processed > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)));
}

function countFailedItems(
  batchIds: readonly string[],
  errors: readonly { itemId: string }[],
): number {
  const requested = new Set(batchIds);
  const failed = new Set(
    errors
      .map(({ itemId }) => itemId)
      .filter((itemId) => requested.has(itemId)),
  );
  const unidentified = errors.filter(({ itemId }) => !requested.has(itemId));
  return Math.min(batchIds.length, failed.size + unidentified.length);
}
