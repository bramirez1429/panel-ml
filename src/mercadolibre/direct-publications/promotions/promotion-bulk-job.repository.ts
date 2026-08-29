import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { Json } from '../../../database/database.types';
import { SupabaseService } from '../../../database/supabase.service';

import type {
  PromotionBulkItemStatus,
  PromotionBulkJob,
  PromotionBulkJobInputItem,
  PromotionBulkJobItem,
} from './promotion-bulk-job.types';

@Injectable()
export class PromotionBulkJobRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(input: {
    id: string;
    userId: string;
    sellerId: number;
    items: PromotionBulkJobInputItem[];
  }): Promise<void> {
    const { data, error } = await this.supabaseService
      .getClient()
      .rpc('create_mercadolibre_promotion_bulk_job', {
        p_job_id: input.id,
        p_user_id: input.userId,
        p_seller_id: input.sellerId,
        p_items: input.items as unknown as Json,
      });
    if (error || data !== input.id) this.persistenceError();
  }

  async findJob(id: string): Promise<PromotionBulkJob | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_promotion_bulk_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) this.persistenceError();
    return data;
  }

  async listItems(jobId: string): Promise<PromotionBulkJobItem[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_promotion_bulk_job_items')
      .select('*')
      .eq('job_id', jobId)
      .order('position');
    if (error || !data) this.persistenceError();
    return data;
  }

  async claimJob(id: string): Promise<boolean> {
    const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .rpc('claim_mercadolibre_promotion_bulk_job', {
        p_job_id: id,
        p_stale_before: staleBefore,
      });
    if (error) this.persistenceError();
    return data === true;
  }

  async claimNextItem(jobId: string): Promise<PromotionBulkJobItem | null> {
    const { data: queued, error: readError } = await this.supabaseService
      .getClient()
      .from('mercadolibre_promotion_bulk_job_items')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'QUEUED')
      .order('position')
      .limit(1)
      .maybeSingle();
    if (readError) this.persistenceError();
    if (!queued) return null;
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_promotion_bulk_job_items')
      .update({
        status: 'PROCESSING',
        processing_started_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', queued.id)
      .eq('status', 'QUEUED')
      .select('*')
      .maybeSingle();
    if (error) this.persistenceError();
    return data;
  }

  async finishItem(
    id: string,
    result: Readonly<{
      status: Extract<
        PromotionBulkItemStatus,
        'SCHEDULED' | 'ACTIVE' | 'ERROR'
      >;
      errorCode?: string;
      providerMessage?: string;
    }>,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_promotion_bulk_job_items')
      .update({
        status: result.status,
        error_code: result.errorCode ?? null,
        provider_message: result.providerMessage?.slice(0, 500) ?? null,
        finished_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', id)
      .eq('status', 'PROCESSING')
      .select('id')
      .maybeSingle();
    if (error || !data) this.persistenceError();
  }

  async refreshProgress(id: string): Promise<PromotionBulkJob> {
    const items = await this.listItems(id);
    const processed = items.filter((item) =>
      ['SCHEDULED', 'ACTIVE', 'ERROR'].includes(item.status),
    );
    const successfulItems = processed.filter((item) =>
      ['SCHEDULED', 'ACTIVE'].includes(item.status),
    ).length;
    const failedItems = processed.filter(
      (item) => item.status === 'ERROR',
    ).length;
    const hasMore = processed.length < items.length;
    const timestamp = new Date().toISOString();
    const status = hasMore
      ? ('QUEUED' as const)
      : failedItems > 0
        ? ('COMPLETED_WITH_ERRORS' as const)
        : ('COMPLETED' as const);
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_promotion_bulk_jobs')
      .update({
        status,
        processed_items: processed.length,
        successful_items: successfulItems,
        failed_items: failedItems,
        locked_at: null,
        finished_at: hasMore ? null : timestamp,
        updated_at: timestamp,
      })
      .eq('id', id)
      .eq('status', 'PROCESSING')
      .select('*')
      .single();
    if (error || !data) this.persistenceError();
    return data;
  }

  private persistenceError(): never {
    throw new ServiceUnavailableException(
      'No se pudo persistir el job de promociones',
    );
  }
}
