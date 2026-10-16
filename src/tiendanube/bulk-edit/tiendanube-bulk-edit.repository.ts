import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../database/supabase.service';
import type { BulkEditChanges, BulkEditSnapshot, BulkEditVariant } from './tiendanube-bulk-edit.types';

type BulkEditJobRow = Readonly<{
  id: string; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'PAUSED';
  category_id: string; total_products: number; total_variants: number;
  completed_variants: number; failed_variants: number; started_at: string | null;
  finished_at: string | null; created_at: string; updated_at: string;
}>;

@Injectable()
export class TiendanubeBulkEditRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async saveSnapshot(input: Omit<BulkEditSnapshot, 'id' | 'expires_at'>): Promise<BulkEditSnapshot> {
    const row = { id: randomUUID(), ...input, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() };
    const { data, error } = await (this.supabase.getClient() as any)
      .from('tiendanube_bulk_edit_snapshots').insert(row).select('*').single();
    if (error || !data) this.fail();
    return data as BulkEditSnapshot;
  }

  async getSnapshot(id: string, userId: string, storeId: string): Promise<BulkEditSnapshot | null> {
    const { data, error } = await (this.supabase.getClient() as any)
      .from('tiendanube_bulk_edit_snapshots').select('*').eq('id', id).eq('user_id', userId).eq('store_id', storeId).maybeSingle();
    if (error) this.fail();
    return data as BulkEditSnapshot | null;
  }

  async createJob(snapshot: BulkEditSnapshot): Promise<string> {
    const id = randomUUID();
    const items = snapshot.variants.map((variant) => ({ id: randomUUID(), job_id: id, product_id: variant.productId, product_name: variant.productName, variant_id: variant.variantId, sku: variant.sku, option_values: variant.optionValues, requested_changes: snapshot.changes, status: 'PENDING' }));
    const client = this.supabase.getClient() as any;
    const { error: jobError } = await client.from('tiendanube_bulk_edit_jobs').insert({ id, user_id: snapshot.user_id, store_id: snapshot.store_id, snapshot_id: snapshot.id, category_id: snapshot.category_id, requested_changes: snapshot.changes, total_products: new Set(snapshot.variants.map((v) => v.productId)).size, total_variants: items.length, status: 'QUEUED' });
    if (jobError) this.fail();
    if (items.length) { const { error } = await client.from('tiendanube_bulk_edit_items').insert(items); if (error) this.fail(); }
    return id;
  }

  async findActive(userId: string, storeId: string): Promise<BulkEditJobRow | null> {
    const { data, error } = await (this.supabase.getClient() as any)
      .from('tiendanube_bulk_edit_jobs').select('*').eq('user_id', userId)
      .eq('store_id', storeId).in('status', ['QUEUED', 'RUNNING', 'PAUSED'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) this.fail();
    return data as BulkEditJobRow | null;
  }

  private fail(): never { throw new ServiceUnavailableException('No se pudo persistir la edición masiva de Tiendanube'); }
}
