import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PUBLICATION_SYNC_BATCH_SIZE } from '../publication.constants';
import { PublicationSourceService } from './publication-source.service';
import {
  SyncJobCompletedResponse,
  SyncJobNextResponse,
  SyncJobPendingResponse,
  SyncJobScanState,
  SyncJobStartResponse,
  SyncJobStatusResponse,
} from './publication-sync-job.types';
import { PublicationSyncService } from './publication-sync.service';
import { SyncAccess } from './publication-sync.types';

@Injectable()
export class PublicationSyncJobService {
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
      if (error instanceof CompletionPersistenceError) {
        throw error.originalError;
      }
      await this.jobsRepository.fail(job.id, safeFatalMessage(error));
      throw error;
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
    let completed: MercadolibreSyncJob;
    try {
      completed = await this.jobsRepository.complete(job.id);
    } catch (error) {
      throw new CompletionPersistenceError(error);
    }
    return this.completedResponse(completed.id);
  }

  /** Busca un trabajo y verifica que sea del vendedor conectado. */
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
}

class CompletionPersistenceError extends Error {
  /** Conserva el error sin convertir un cleanup exitoso en FAILED. */
  constructor(readonly originalError: unknown) {
    super('No se pudo persistir la finalización');
  }
}

/** Convierte una falla fatal en un mensaje breve sin credenciales. */
function safeFatalMessage(error: unknown): string {
  if (!(error instanceof HttpException)) {
    return 'La sincronización no pudo continuar';
  }
  const status = error.getStatus();
  if (status === 401) return 'La conexión con Mercado Libre no está autorizada';
  if (status === 504) return 'Mercado Libre agotó el tiempo de respuesta';
  if (status >= 500) return 'Un servicio externo impidió continuar';
  return 'La sincronización no pudo continuar';
}
