import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { Database, Json } from '../database.types';
import { SupabaseService } from '../supabase.service';
import {
  CreateMercadolibreSyncJobInput,
  MercadolibreSyncJob,
  UpdateMercadolibreSyncJobProgressInput,
} from './mercadolibre-sync-jobs.types';

type DatabaseSyncJobRow =
  Database['public']['Tables']['mercadolibre_sync_jobs']['Row'];

@Injectable()
export class MercadolibreSyncJobsRepository {
  private readonly logger = new Logger(MercadolibreSyncJobsRepository.name);

  /** Recibe el cliente compartido de Supabase. */
  constructor(private readonly supabaseService: SupabaseService) {}

  /** Crea un trabajo pendiente sin iniciar el scan. */
  async create(
    input: CreateMercadolibreSyncJobInput,
  ): Promise<MercadolibreSyncJob> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_jobs')
      .insert({
        id: input.id,
        seller_id: input.sellerId,
        full_sync_id: input.fullSyncId,
      })
      .select('*')
      .single();

    if (error) this.writeError(error);
    if (!data) this.writeError('Supabase no devolvió el job creado');
    return this.mapJob(data);
  }

  /** Busca un trabajo por su UUID. */
  async findById(id: string): Promise<MercadolibreSyncJob | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) this.readError(error);
    return data ? this.mapJob(data) : null;
  }

  /** Reserva un job PENDING para evitar procesamiento duplicado. */
  async claim(
    id: string,
    startedAt: string | null,
  ): Promise<MercadolibreSyncJob> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_jobs')
      .update({
        status: 'RUNNING',
        updated_at: timestamp,
        ...(startedAt ? {} : { started_at: timestamp }),
      })
      .eq('id', id)
      .eq('status', 'PENDING')
      .select('*')
      .maybeSingle();

    return this.requireTransition(data, error);
  }

  /** Guarda el avance y libera el job para el siguiente bloque. */
  async updateProgress(
    id: string,
    input: UpdateMercadolibreSyncJobProgressInput,
  ): Promise<MercadolibreSyncJob> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_jobs')
      .update({
        status: 'PENDING',
        scan_started: input.scanStarted,
        scroll_id: input.scrollId,
        buffer_item_ids: input.bufferItemIds,
        processed_items: input.processedItems,
        products_saved: input.productsSaved,
        children_saved: input.childrenSaved,
        errors_count: input.errorsCount,
        retry_count: 0,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'RUNNING')
      .select('*')
      .maybeSingle();

    return this.requireTransition(data, error);
  }

  /** Devuelve el job a PENDING después de un error temporal. */
  async releaseAfterError(
    id: string,
    safeMessage: string,
    retryCount: number,
  ): Promise<MercadolibreSyncJob> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_jobs')
      .update({
        status: 'PENDING',
        retry_count: retryCount,
        last_error: safeMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'RUNNING')
      .select('*')
      .maybeSingle();

    return this.requireTransition(data, error);
  }

  /** Marca el trabajo como completado. */
  async complete(id: string): Promise<MercadolibreSyncJob> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_jobs')
      .update({
        status: 'COMPLETED',
        retry_count: 0,
        finished_at: timestamp,
        last_error: null,
        updated_at: timestamp,
      })
      .eq('id', id)
      .eq('status', 'RUNNING')
      .select('*')
      .maybeSingle();

    return this.requireTransition(data, error);
  }

  /** Marca como FAILED solamente un error no recuperable. */
  async fail(id: string, safeMessage: string): Promise<MercadolibreSyncJob> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_jobs')
      .update({
        status: 'FAILED',
        last_error: safeMessage,
        finished_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', id)
      .eq('status', 'RUNNING')
      .select('*')
      .maybeSingle();

    return this.requireTransition(data, error);
  }

  /** Valida que la transición haya actualizado exactamente un job. */
  private requireTransition(
    data: DatabaseSyncJobRow | null,
    error: unknown,
  ): MercadolibreSyncJob {
    if (error) this.writeError(error);
    if (!data) {
      throw new ConflictException(
        'La sincronización ya está siendo procesada o finalizó',
      );
    }
    return this.mapJob(data);
  }

  /** Convierte la fila de Supabase al modelo interno. */
  private mapJob(row: DatabaseSyncJobRow): MercadolibreSyncJob {
    return { ...row, buffer_item_ids: this.parseBuffer(row.buffer_item_ids) };
  }

  /** Verifica que el buffer contenga solamente IDs string. */
  private parseBuffer(value: Json): string[] {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== 'string')
    ) {
      this.readError('buffer_item_ids inválido');
    }
    return value as string[];
  }

  /** Registra un error de lectura sin devolver detalles al cliente. */
  private readError(error?: unknown): never {
    this.logger.error(
      'Error leyendo mercadolibre_sync_jobs',
      error instanceof Error ? error.stack : String(error),
    );
    throw new ServiceUnavailableException(
      'No se pudo leer la sincronización de Mercado Libre',
    );
  }

  /** Registra un error de escritura sin filtrar datos internos. */
  private writeError(error?: unknown): never {
    this.logger.error(
      'Error actualizando mercadolibre_sync_jobs',
      error instanceof Error ? error.stack : String(error),
    );
    throw new ServiceUnavailableException(
      'No se pudo actualizar la sincronización de Mercado Libre',
    );
  }
}
