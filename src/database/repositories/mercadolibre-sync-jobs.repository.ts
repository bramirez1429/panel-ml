import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Database, Json } from '../database.types';
import { SupabaseService } from '../supabase.service';
import {
  CreateMercadolibreSyncJobInput,
  MercadolibreSyncJob,
  UpdateMercadolibreSyncJobProgressInput,
} from './mercadolibre-sync-jobs.types';

@Injectable()
export class MercadolibreSyncJobsRepository {
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

    if (error || !data) this.writeError();
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

    if (error) this.readError();
    return data ? this.mapJob(data) : null;
  }

  /** Reserva un trabajo pendiente para una sola llamada. */
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

  /** Guarda el buffer y libera el trabajo para el próximo bloque. */
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'RUNNING')
      .select('*')
      .maybeSingle();

    return this.requireTransition(data, error);
  }

  /** Marca un trabajo reclamado como completado. */
  async complete(id: string): Promise<MercadolibreSyncJob> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_jobs')
      .update({
        status: 'COMPLETED',
        finished_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', id)
      .eq('status', 'RUNNING')
      .select('*')
      .maybeSingle();

    return this.requireTransition(data, error);
  }

  /** Marca un trabajo reclamado como fallido. */
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

  /** Valida que una transición haya actualizado una fila. */
  private requireTransition(
    data: DatabaseSyncJobRow | null,
    error: unknown,
  ): MercadolibreSyncJob {
    if (error) this.writeError();
    if (!data) {
      throw new ConflictException(
        'La sincronización ya está siendo procesada o finalizó',
      );
    }
    return this.mapJob(data);
  }

  /** Convierte el buffer JSON en una lista de IDs segura. */
  private mapJob(row: DatabaseSyncJobRow): MercadolibreSyncJob {
    return {
      ...row,
      buffer_item_ids: this.parseBuffer(row.buffer_item_ids),
    };
  }

  /** Verifica que el buffer contenga solamente strings. */
  private parseBuffer(value: Json): string[] {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== 'string')
    ) {
      this.readError();
    }
    return value as string[];
  }

  /** Informa un fallo de lectura sin filtrar datos internos. */
  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudo leer la sincronización de Mercado Libre',
    );
  }

  /** Informa un fallo de escritura sin filtrar datos internos. */
  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo actualizar la sincronización de Mercado Libre',
    );
  }
}

type DatabaseSyncJobRow =
  Database['public']['Tables']['mercadolibre_sync_jobs']['Row'];
