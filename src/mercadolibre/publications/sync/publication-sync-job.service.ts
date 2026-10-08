import {
  ConflictException,
  ForbiddenException,
  HttpException,
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
  SyncJobFailedResponse,
  SyncJobNextResponse,
  SyncJobPendingResponse,
  SyncJobScanState,
  SyncJobStartResponse,
  SyncJobStatusResponse,
} from './publication-sync-job.types';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncService } from './publication-sync.service';
import {
  PublicationBatchDiagnostics,
  PublicationSyncError,
  SyncAccess,
} from './publication-sync.types';

const MAX_CONSECUTIVE_RETRIES = 3;
type SyncJobStage = 'SCAN' | 'SYNC_BATCH' | 'CHECKPOINT' | 'FINALIZE';
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
  async start(userId: string): Promise<SyncJobStartResponse> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const active = await this.jobsRepository.findActiveBySellerId(
      connection.seller_id,
    );
    if (active) return this.startResponse(active);

    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const totalItems = await this.sourceService.getItemsTotal(
      connection.seller_id,
      accessToken,
    );
    let job: MercadolibreSyncJob;
    try {
      job = await this.jobsRepository.create({
        id: randomUUID(),
        sellerId: connection.seller_id,
        fullSyncId: randomUUID(),
        totalItems,
      });
    } catch (error) {
      const concurrent = await this.jobsRepository.findActiveBySellerId(
        connection.seller_id,
      );
      if (concurrent) return this.startResponse(concurrent);
      throw error;
    }
    return this.startResponse(job);
  }

  /** Procesa el siguiente bloque del trabajo. */
  async processNext(
    userId: string,
    syncId: string,
  ): Promise<SyncJobNextResponse> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const existing = await this.findOwnedJob(syncId, connection.seller_id);
    if (existing.status === 'COMPLETED') {
      return this.completedResponse(existing.id);
    }
    if (existing.status === 'FAILED') {
      throw new ConflictException('La sincronización finalizó con error');
    }
    if (existing.status === 'CANCELLED') {
      throw new ConflictException('La sincronización fue cancelada');
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
    return this.statusResponse(job);
  }

  /** Devuelve el trabajo activo del seller autenticado, si existe. */
  async getActive(
    userId: string,
  ): Promise<SyncJobStatusResponse | null> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const job = await this.jobsRepository.findActiveBySellerId(
      connection.seller_id,
    );
    return job ? this.statusResponse(job) : null;
  }

  /** Cancela un trabajo que pertenezca al seller autenticado. */
  async cancel(userId: string, syncId: string): Promise<SyncJobStatusResponse> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const job = await this.findOwnedJob(syncId, connection.seller_id);
    if (job.status !== 'PENDING' && job.status !== 'RUNNING') {
      throw new ConflictException('La sincronización ya finalizó');
    }
    return this.statusResponse(await this.jobsRepository.cancel(job.id));
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
    const result = await this.runStage(job.id, 'SYNC_BATCH', () =>
      this.syncService.syncBatch(batchIds, access, job.full_sync_id),
    );
    this.logBatchDiagnostics(job.id, result.diagnostics);
    const batchProgress = calculateBatchProgress(batchIds, result.errors);
    const progress = {
      scanStarted: scan.scanStarted,
      scrollId: scan.scrollId,
      bufferItemIds: scan.bufferItemIds.slice(PUBLICATION_SYNC_BATCH_SIZE),
      processedItems: job.processed_items + batchProgress.processedItems,
      successfulItems: job.successful_items + batchProgress.successfulItems,
      failedItems: job.failed_items + batchProgress.failedItems,
      productsSaved: job.products_saved + result.productsSaved,
      childrenSaved: job.children_saved + result.childrenSaved,
      errorsCount: job.errors_count + result.errors.length,
    };
    if (isFirstBatchFailure(job, batchIds, batchProgress, result)) {
      const failed = await this.runStage(job.id, 'CHECKPOINT', () =>
        this.jobsRepository.failWithProgress(
          job.id,
          progress,
          'El primer lote no pudo guardar ninguna publicación',
        ),
      );
      return this.failedResponse(failed.id);
    }
    const updated = await this.runStage(job.id, 'CHECKPOINT', () =>
      this.jobsRepository.updateProgress(job.id, progress),
    );
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

    const page = await this.runStage(job.id, 'SCAN', () =>
      this.sourceService.fetchNextScanPage(
        access.sellerId,
        access.accessToken,
        job.scan_started ? (job.scroll_id ?? undefined) : undefined,
      ),
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
  ): Promise<SyncJobNextResponse> {
    const startedAt = job.started_at;
    if (!startedAt) {
      throw new ServiceUnavailableException(
        'No se pudo finalizar la sincronización de Mercado Libre',
      );
    }
    const failureMessage = completionFailureMessage(job);
    if (failureMessage) {
      const failed = await this.runStage(job.id, 'FINALIZE', () =>
        this.jobsRepository.fail(job.id, failureMessage),
      );
      return this.failedResponse(failed.id);
    }
    return this.runStage(job.id, 'FINALIZE', async () => {
      await this.syncService.finalizeFullSync(
        sellerId,
        job.full_sync_id,
        startedAt,
      );
      try {
        const completed = await this.jobsRepository.complete(job.id);
        return this.completedResponse(completed.id);
      } catch (error) {
        throw new CompletionPersistenceError(error);
      }
    });
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

  /** Construye la respuesta terminal de un trabajo fallido. */
  private failedResponse(syncId: string): SyncJobFailedResponse {
    return { ok: true, syncId, status: 'FAILED', hasMore: false };
  }

  /** Construye la respuesta inicial para un job nuevo o ya activo. */
  private startResponse(job: MercadolibreSyncJob): SyncJobStartResponse {
    return this.statusResponse(job);
  }

  /** Construye el contrato de progreso compartido por inicio y consulta. */
  private statusResponse(job: MercadolibreSyncJob): SyncJobStatusResponse {
    return {
      ok: true,
      syncId: job.id,
      status: job.status,
      totalItems: job.total_items,
      processedItems: job.processed_items,
      productsSaved: job.products_saved,
      childrenSaved: job.children_saved,
      errorsCount: job.errors_count,
      lastError: job.last_error,
      hasMore: job.status === 'PENDING' || job.status === 'RUNNING',
    };
  }

  /** Registra una etapa sin incluir tokens, publicaciones ni respuestas externas. */
  private async runStage<T>(
    syncId: string,
    stage: SyncJobStage,
    action: () => Promise<T>,
  ): Promise<T> {
    this.logger.log(`syncId=${syncId} etapa=${stage}`);
    try {
      return await action();
    } catch (error) {
      const sourceError =
        error instanceof CompletionPersistenceError ? error.originalError : error;
      const httpStatus =
        sourceError instanceof HttpException ? sourceError.getStatus() : 'N/A';
      this.logger.error(
        `syncId=${syncId} etapa=${stage} httpStatus=${httpStatus}`,
        safeSyncErrorLabel(sourceError),
      );
      throw error;
    }
  }

  /** Registra el error sin incluir mensajes ni credenciales. */
  private logSyncError(syncId: string, error: unknown): void {
    this.logger.error(
      `Falló sincronización ${syncId}`,
      safeSyncErrorLabel(error),
    );
  }

  /** Registra solo contadores y estados HTTP de los errores del lote. */
  private logBatchDiagnostics(
    syncId: string,
    diagnostics: PublicationBatchDiagnostics | undefined,
  ): void {
    const current = diagnostics ?? {
      sourceErrors: 0,
      sourceHttpStatuses: {},
      ownedErrors: 0,
      preparedErrors: 0,
      variantResultErrors: 0,
    };
    const httpStatuses = Object.entries(current.sourceHttpStatuses)
      .map(([status, count]) => `${status}:${count}`)
      .join(',') || 'none';
    this.logger.log(
      `syncId=${syncId} etapa=SYNC_BATCH source.errors=${current.sourceErrors} owned.errors=${current.ownedErrors} prepared.errors=${current.preparedErrors} variantResult.errors=${current.variantResultErrors} multigetHttp=${httpStatuses}`,
    );
  }
}

/** Calcula resultados de lote conservando la restricción de progreso SQL. */
function calculateBatchProgress(
  itemIds: readonly string[],
  errors: readonly PublicationSyncError[],
): {
  processedItems: number;
  successfulItems: number;
  failedItems: number;
} {
  const batchItemIds = new Set(itemIds);
  const failedItemIds = new Set<string>();
  let hasUnidentifiedError = false;

  for (const error of errors) {
    if (
      typeof error.itemId !== 'string' ||
      !batchItemIds.has(error.itemId)
    ) {
      hasUnidentifiedError = true;
      continue;
    }
    failedItemIds.add(error.itemId);
  }

  const processedItems = itemIds.length;
  const failedItems = hasUnidentifiedError
    ? processedItems
    : failedItemIds.size;
  return {
    processedItems,
    successfulItems: processedItems - failedItems,
    failedItems,
  };
}

/** Detecta un primer lote completamente fallido antes de continuar el scan. */
function isFirstBatchFailure(
  job: MercadolibreSyncJob,
  itemIds: readonly string[],
  progress: {
    processedItems: number;
    successfulItems: number;
    failedItems: number;
  },
  result: { productsSaved: number; childrenSaved: number },
): boolean {
  return (
    job.processed_items === 0 &&
    itemIds.length === PUBLICATION_SYNC_BATCH_SIZE &&
    progress.failedItems === itemIds.length &&
    result.productsSaved === 0 &&
    result.childrenSaved === 0
  );
}

/** Evita el cleanup cuando el scan terminó con errores o resultados incompletos. */
function completionFailureMessage(job: MercadolibreSyncJob): string | null {
  if (job.processed_items !== job.total_items) {
    return 'La sincronización finalizó con publicaciones sin procesar';
  }
  if (job.failed_items > 0 || job.errors_count > 0) {
    return 'La sincronización finalizó con publicaciones fallidas';
  }
  if (job.total_items > 0 && job.products_saved === 0) {
    return 'La sincronización no guardó publicaciones detectadas';
  }
  return null;
}
