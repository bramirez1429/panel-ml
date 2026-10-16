import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../database/supabase.service';
import type { BulkEditItem, BulkEditJob, BulkEditSnapshot } from './tiendanube-bulk-edit.types';

@Injectable()
export class TiendanubeBulkEditRepository {
  constructor(private readonly supabase: SupabaseService) {}
  private client() { return this.supabase.getClient() as any; }

  async saveSnapshot(input: Omit<BulkEditSnapshot, 'id' | 'expires_at'>): Promise<BulkEditSnapshot> {
    const row = { id: randomUUID(), ...input, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() };
    const { data, error } = await this.client().from('tiendanube_bulk_edit_snapshots').insert(row).select('*').single();
    if (error || !data) this.fail(error, 'guardar el snapshot'); return data;
  }
  async getSnapshot(id: string, userId: string, storeId: string): Promise<BulkEditSnapshot | null> {
    const { data, error } = await this.client().from('tiendanube_bulk_edit_snapshots').select('*').eq('id', id).eq('user_id', userId).eq('store_id', storeId).maybeSingle();
    if (error) this.fail(error, 'consultar el snapshot'); return data;
  }
  async createJob(snapshot: BulkEditSnapshot): Promise<BulkEditJob> {
    const id = randomUUID(); const token = randomUUID();
    const { data, error } = await this.client().rpc('create_tiendanube_bulk_edit_job', { p_job_id: id, p_execution_token: token, p_snapshot_id: snapshot.id });
    if (error || data !== id) this.fail(error, 'crear el trabajo'); const job = await this.findJob(id); if (!job) this.fail(undefined, 'leer el trabajo creado'); return job;
  }
  async findJob(id: string): Promise<BulkEditJob | null> { const { data, error } = await this.client().from('tiendanube_bulk_edit_jobs').select('*').eq('id', id).maybeSingle(); if (error) this.fail(); return data; }
  async findActive(userId: string, storeId: string): Promise<BulkEditJob | null> { const { data, error } = await this.client().from('tiendanube_bulk_edit_jobs').select('*').eq('user_id', userId).eq('store_id', storeId).in('status', ['QUEUED','RUNNING','PAUSED']).order('created_at',{ascending:false}).limit(1).maybeSingle(); if(error)this.fail(); return data; }
  async claimJob(id: string, token: string): Promise<boolean> { const { data,error }=await this.client().rpc('claim_tiendanube_bulk_edit_job',{p_job_id:id,p_execution_token:token,p_now:new Date().toISOString(),p_lease_seconds:120}); if(error||typeof data!=='boolean')this.fail(); return data; }
  async claimItems(id: string, token: string): Promise<BulkEditItem[]> { const {data,error}=await this.client().rpc('claim_tiendanube_bulk_edit_items',{p_job_id:id,p_execution_token:token,p_limit:50}); if(error||!Array.isArray(data))this.fail(); return data; }
  async finishItems(jobId:string, token:string, successes: readonly string[], failures: readonly {id:string; code:string; message:string}[]): Promise<void> { const {data,error}=await this.client().rpc('finish_tiendanube_bulk_edit_items',{p_job_id:jobId,p_execution_token:token,p_success_item_ids:successes,p_failures:failures}); if(error||data!==true)this.fail(); }
  async retryItems(jobId:string, token:string, ids:readonly string[], message:string): Promise<void> { const {data,error}=await this.client().rpc('retry_tiendanube_bulk_edit_items',{p_job_id:jobId,p_execution_token:token,p_item_ids:ids,p_error_message:message}); if(error||data!==true)this.fail(); }
  async refresh(id:string, token:string): Promise<BulkEditJob> { const {data,error}=await this.client().rpc('refresh_tiendanube_bulk_edit_job',{p_job_id:id,p_execution_token:token}); if(error||!data)this.fail(); return data; }
  async failures(jobId:string): Promise<BulkEditItem[]> { const {data,error}=await this.client().from('tiendanube_bulk_edit_items').select('*').eq('job_id',jobId).eq('status','ERROR').order('updated_at'); if(error||!data)this.fail(); return data; }
  async retryFailures(jobId:string): Promise<{count:number; executionToken:string|null}> { const {data,error}=await this.client().rpc('retry_tiendanube_bulk_edit_failures',{p_job_id:jobId}); if(error||!data||typeof data.count!=='number')this.fail(); return data; }
  private fail(error?: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null, operation?: string): never {
    throw new ServiceUnavailableException({
      message: 'No se pudo persistir la edición masiva de Tiendanube',
      operation: operation ?? 'operación de persistencia',
      supabase: {
        code: field(error?.code), message: field(error?.message), details: field(error?.details), hint: field(error?.hint),
      },
    });
  }
}
function field(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : null; }
