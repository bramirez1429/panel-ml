import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Json } from '../../database/database.types';
import { SupabaseService } from '../../database/supabase.service';
import type {
  ClaimedTiendanubeMigrationItem,
  DiscoveredTiendanubeMigrationItem,
  TiendanubeMigrationItem,
  TiendanubeMigrationItemStatus,
  TiendanubeMigrationJob,
  TiendanubeMigrationJobStatus,
  TiendanubeMigrationOutcome,
} from './tiendanube-migration.types';

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};
type ClaimRow = {
  id: string;
  source_key: string;
  title: string | null;
  mla_ids: string[];
  family_id: string | null;
  mlau_ids: string[];
  attempts: number;
  is_reconciliation: boolean;
};
type MigrationDatabase = {
  public: {
    Tables: {
      tiendanube_migration_jobs: Table<TiendanubeMigrationJob>;
      tiendanube_migration_items: Table<TiendanubeMigrationItem>;
    };
    Views: Record<string, never>;
    Functions: Record<
      string,
      { Args: Record<string, unknown>; Returns: unknown }
    >;
  };
};

@Injectable()
export class SupabaseTiendanubeMigrationRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async createOrGetActive(input: {
    id: string;
    userId: string;
    sellerId: number;
    storeId: string;
    testLimit: 1 | 5 | 10 | null;
  }): Promise<TiendanubeMigrationJob> {
    const { data, error } = await this.client().rpc(
      'create_tiendanube_migration_job',
      {
        p_job_id: input.id,
        p_user_id: input.userId,
        p_seller_id: input.sellerId,
        p_store_id: input.storeId,
        p_test_limit: input.testLimit,
      },
    );
    if (error || typeof data !== 'string') this.fail();
    const job = await this.findJob(data);
    if (!job) this.fail();
    return job;
  }

  async findJob(id: string): Promise<TiendanubeMigrationJob | null> {
    const { data, error } = await this.client()
      .from('tiendanube_migration_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail();
    return data;
  }

  async findActive(userId: string, sellerId: number, storeId: string) {
    const { data, error } = await this.client()
      .from('tiendanube_migration_jobs')
      .select('*')
      .eq('user_id', userId)
      .eq('seller_id', sellerId)
      .eq('store_id', storeId)
      .not('status', 'in', '(COMPLETED,COMPLETED_WITH_REJECTIONS)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.fail();
    return data;
  }

  async claimJob(jobId: string): Promise<boolean> {
    const { data, error } = await this.client().rpc(
      'claim_tiendanube_migration_job',
      {
        p_job_id: jobId,
        p_now: new Date().toISOString(),
        p_lease_seconds: 120,
      },
    );
    if (error || typeof data !== 'boolean') this.fail();
    return data;
  }

  async recordDiscoveryPage(input: {
    jobId: string;
    nextScrollId: string | null;
    finished: boolean;
    items: readonly DiscoveredTiendanubeMigrationItem[];
  }): Promise<void> {
    await this.callVoid('record_tiendanube_migration_discovery_page', {
      p_job_id: input.jobId,
      p_next_scroll_id: input.nextScrollId,
      p_finished: input.finished,
      p_items: input.items.map((item) => ({
        source_key: item.sourceKey,
        title: item.title,
        mla_ids: item.mlaIds,
        family_id: item.familyId,
        mlau_ids: item.mlauIds,
      })) as unknown as Json,
    });
  }

  async claimNextItem(
    jobId: string,
  ): Promise<ClaimedTiendanubeMigrationItem | null> {
    const { data, error } = await this.client().rpc(
      'claim_next_tiendanube_migration_item',
      { p_job_id: jobId },
    );
    if (error || !Array.isArray(data)) this.fail();
    if (data.length === 0) return null;
    if (data.length !== 1) this.fail();
    const row = data[0] as ClaimRow;
    return {
      id: row.id,
      sourceKey: row.source_key,
      title: row.title,
      mlaIds: row.mla_ids,
      familyId: row.family_id,
      mlauIds: row.mlau_ids,
      attempts: row.attempts,
      isReconciliation: row.is_reconciliation,
    };
  }

  async markPostStarted(itemId: string): Promise<void> {
    const { data, error } = await this.client().rpc(
      'mark_tiendanube_migration_post_started',
      { p_item_id: itemId },
    );
    if (error || data !== true) this.fail();
  }

  async finishItem(input: {
    itemId: string;
    status: 'APPROVED' | 'REJECTED';
    outcome?: TiendanubeMigrationOutcome;
    tiendanubeProductId?: string;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    await this.callVoid('finish_tiendanube_migration_item', {
      p_item_id: input.itemId,
      p_status: input.status,
      p_outcome: input.outcome ?? null,
      p_tiendanube_product_id: input.tiendanubeProductId ?? null,
      p_error_code: input.errorCode ?? null,
      p_error_message: input.errorMessage ?? null,
    });
  }

  async retryItem(
    itemId: string,
    delaySeconds: number,
    errorMessage: string,
  ): Promise<void> {
    await this.callVoid('retry_tiendanube_migration_item', {
      p_item_id: itemId,
      p_delay_seconds: delaySeconds,
      p_error_code: 'TEMPORARY_ERROR',
      p_error_message: errorMessage,
    });
  }

  async waitForReconciliation(
    itemId: string,
    delaySeconds: number,
    message: string,
  ): Promise<void> {
    await this.callVoid('wait_tiendanube_migration_reconciliation', {
      p_item_id: itemId,
      p_delay_seconds: delaySeconds,
      p_error_message: message,
    });
  }

  async pauseJob(jobId: string, message: string): Promise<void> {
    await this.callVoid('pause_tiendanube_migration_job', {
      p_job_id: jobId,
      p_error_message: message,
    });
  }

  async retryDiscovery(
    jobId: string,
    delaySeconds: number,
    message: string,
  ): Promise<void> {
    await this.callVoid('retry_tiendanube_migration_discovery', {
      p_job_id: jobId,
      p_delay_seconds: delaySeconds,
      p_error_message: message,
    });
  }

  async completeEmptyJob(jobId: string): Promise<void> {
    await this.callVoid('complete_empty_tiendanube_migration_job', {
      p_job_id: jobId,
    });
  }

  async listItems(
    jobId: string,
    status: TiendanubeMigrationItemStatus,
    page: number,
    limit: number,
  ) {
    const from = (page - 1) * limit;
    const { data, error, count } = await this.client()
      .from('tiendanube_migration_items')
      .select('*', { count: 'exact' })
      .eq('job_id', jobId)
      .eq('status', status)
      .order('created_at')
      .range(from, from + limit - 1);
    if (error || data === null || count === null) this.fail();
    return { items: data, total: count };
  }

  private async callVoid(
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client().rpc(name, args);
    if (error) this.fail();
  }

  private client(): SupabaseClient<MigrationDatabase> {
    return this.supabaseService.getClient() as unknown as SupabaseClient<MigrationDatabase>;
  }

  private fail(): never {
    throw new ServiceUnavailableException(
      'No se pudo persistir la migración de Tiendanube',
    );
  }
}
