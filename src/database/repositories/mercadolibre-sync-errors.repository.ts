import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SyncErrorInsert, SyncErrorRow } from '../database.types';
import { SupabaseService } from '../supabase.service';

@Injectable()
export class MercadolibreSyncErrorsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async createMany(errors: SyncErrorInsert[]): Promise<void> {
    if (errors.length === 0) return;
    const { error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_errors')
      .insert(errors);
    if (error) this.writeError();
  }

  async findOpen(
    sellerId: number,
    syncJobId?: string,
  ): Promise<SyncErrorRow[]> {
    let query = this.supabaseService
      .getClient()
      .from('mercadolibre_sync_errors')
      .select('*')
      .eq('seller_id', sellerId)
      .in('status', ['OPEN', 'RETRYING']);
    if (syncJobId) query = query.eq('sync_job_id', syncJobId);
    const { data, error } = await query.order('created_at', {
      ascending: true,
    });
    if (error || !data) this.readError();
    return data;
  }

  async findOpenByIds(
    sellerId: number,
    ids: readonly string[],
  ): Promise<SyncErrorRow[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_errors')
      .select('*')
      .eq('seller_id', sellerId)
      .in('status', ['OPEN', 'RETRYING'])
      .in('id', [...ids]);
    if (error || !data) this.readError();
    return data;
  }

  async markRetrying(error: SyncErrorRow): Promise<void> {
    const { error: writeError } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_errors')
      .update({
        status: 'RETRYING',
        attempts: error.attempts + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', error.id);
    if (writeError) this.writeError();
  }

  async resolve(id: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const { error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_errors')
      .update({
        status: 'RESOLVED',
        resolved_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', id);
    if (error) this.writeError();
  }

  async reopen(
    id: string,
    message: string,
    type: SyncErrorRow['error_type'],
  ): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_sync_errors')
      .update({
        status: 'OPEN',
        error_type: type,
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
        resolved_at: null,
      })
      .eq('id', id);
    if (error) this.writeError();
  }

  async countOpen(sellerId: number, syncJobId?: string): Promise<number> {
    let query = this.supabaseService
      .getClient()
      .from('mercadolibre_sync_errors')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .in('status', ['OPEN', 'RETRYING']);
    if (syncJobId) query = query.eq('sync_job_id', syncJobId);
    const { count, error } = await query;
    if (error || count === null) this.readError();
    return count;
  }

  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron leer los errores de sincronización',
    );
  }

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar el error de sincronización',
    );
  }
}
