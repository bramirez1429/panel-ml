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
  ) {}

  /** Crea una sincronización sin procesar publicaciones todavía. */
  async start(): Promise<SyncJobStartResponse> {
    const connection = await this.tokenService.getStoredConnection();
    const job = await this.jobsRepository.create({
      id: randomUUID(),
      sellerId: connection.seller_id,
      fullSyncId: randomUUID(),
    });
    return { ok: true, syncId: job.id, status: 'PENDING' };
  }

  /** Procesa el siguiente bloque del trabajo. */
  async processNext(syncId: string): Promise<SyncJobNextResponse> {
    const connection = await this.tokenService.getStoredConnection();
    const existing = await this.findOwnedJob(syncId, connection.seller_id);
    if (existing.status === 'COMPLETED') {
      return this.completedResponse(existing.id);
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
        accessToken: await this.tokenService.getValidAccessToken(connection),
      };
      return await this.processClaimedJob(job, access);
    } catch (error) {
      return this.handleClaimedError(job, error);
    }
  }

  /** Devuelve el estado acumulado sin exponer datos internos. */
  async getStatus(syncId: string): Promise<SyncJobStatusResponse> {
    const connection = await this.tokenService.getStoredConnection();
    const job = await this.findOwnedJob(syncId, connection.seller_id);
    return {
      ok: true,
      syncId: job.id,
      status: job.status,
      processedItems: job.processed_items,
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
    const updated = await this.jobsRepository.updateProgress(job.id, {
      scanStarted: scan.scanStarted,
      scrollId: scan.scrollId,
      bufferItemIds: scan.bufferItemIds.slice(PUBLICATION_SYNC_BATCH_SIZE),
      processedItems: job.processed_items + batchIds.length,
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
    await this.syncService.finalizeFullSync(
      sellerId,
      job.full_sync_id,
      job.started_at,
    );
    try {
      const completed = await this.jobsRepository.complete(job.id);
      return this.completedResponse(completed.id);
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
      productsSaved: job.products_saved,
      childrenSaved: job.children_saved,
      errorsCount: job.errors_count,
      hasMore: true,
    };
  }

  /** Construye la respuesta de un trabajo completado. */
  private completedResponse(syncId: string): SyncJobCompletedResponse {
    return { ok: true, syncId, status: 'COMPLETED', hasMore: false };
  }

  /** Registra el error sin incluir mensajes ni credenciales. */
  private logSyncError(syncId: string, error: unknown): void {
    this.logger.error(
      `Falló sincronización ${syncId}`,
      safeSyncErrorLabel(error),
    );
  }
}
