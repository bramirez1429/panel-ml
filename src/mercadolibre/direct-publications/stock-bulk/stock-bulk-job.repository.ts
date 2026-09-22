import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Json } from '../../../database/database.types';
import { SupabaseService } from '../../../database/supabase.service';
import type {
  StockBulkItemStatus,
  StockBulkJob,
  StockBulkJobItem,
  StockBulkTarget,
} from './stock-bulk.types';

type DatabaseTable<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type DatabaseStockBulkJobItem = Omit<StockBulkJobItem, 'result'> & {
  result: Json;
};

type StockBulkDatabase = {
  public: {
    Tables: {
      mercadolibre_stock_bulk_jobs: DatabaseTable<StockBulkJob>;
      mercadolibre_stock_bulk_job_items: DatabaseTable<DatabaseStockBulkJobItem>;
    };
    Views: Record<string, never>;
    Functions: {
      create_mercadolibre_stock_bulk_job: {
        Args: {
          p_job_id: string;
          p_user_id: string;
          p_seller_id: number;
          p_targets: Json;
        };
        Returns: string;
      };
      claim_mercadolibre_stock_bulk_job: {
        Args: { p_job_id: string; p_stale_before: string };
        Returns: boolean;
      };
      retry_mercadolibre_stock_bulk_errors: {
        Args: { p_job_id: string };
        Returns: number;
      };
    };
  };
};

type SupabasePersistenceError = Readonly<{
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}>;

@Injectable()
export class StockBulkJobRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(input: {
    id: string;
    userId: string;
    sellerId: number;
    targets: readonly StockBulkTarget[];
  }): Promise<void> {
    const { data, error } = await this.client().rpc(
      'create_mercadolibre_stock_bulk_job',
      {
        p_job_id: input.id,
        p_user_id: input.userId,
        p_seller_id: input.sellerId,
        p_targets: input.targets as unknown as Json,
      },
    );
    if (error) this.persistenceError(error);
    if (data !== input.id) {
      this.persistenceError({
        code: 'UNEXPECTED_RPC_RESULT',
        message: 'La RPC no devolvi\u00f3 el id del job creado',
        details: `expected=${input.id}; received=${String(data)}`,
        hint: 'Verificar la definici\u00f3n de create_mercadolibre_stock_bulk_job',
      });
    }
  }

  async findJob(id: string): Promise<StockBulkJob | null> {
    const { data, error } = await this.client()
      .from('mercadolibre_stock_bulk_jobs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) this.persistenceError(error);
    return data;
  }

  async listItems(jobId: string): Promise<StockBulkJobItem[]> {
    const { data, error } = await this.client()
      .from('mercadolibre_stock_bulk_job_items')
      .select('*')
      .eq('job_id', jobId)
      .order('position');
    if (error) this.persistenceError(error);
    if (!data) this.persistenceError(emptyResult('listar items'));
    return data;
  }

  async claimJob(id: string): Promise<boolean> {
    const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data, error } = await this.client().rpc(
      'claim_mercadolibre_stock_bulk_job',
      { p_job_id: id, p_stale_before: staleBefore },
    );
    if (error) this.persistenceError(error);
    return data === true;
  }

  async claimNextItem(jobId: string): Promise<StockBulkJobItem | null> {
    const { data: pending, error: readError } = await this.client()
      .from('mercadolibre_stock_bulk_job_items')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'PENDING')
      .order('position')
      .limit(1)
      .maybeSingle();
    if (readError) this.persistenceError(readError);
    if (!pending) return null;
    const timestamp = new Date().toISOString();
    const { data, error } = await this.client()
      .from('mercadolibre_stock_bulk_job_items')
      .update({
        status: 'PROCESSING',
        attempt_count: Number(pending.attempt_count ?? 0) + 1,
        processing_started_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', pending.id)
      .eq('status', 'PENDING')
      .select('*')
      .maybeSingle();
    if (error) this.persistenceError(error);
    return data;
  }

  async finishItem(
    id: string,
    result: Readonly<{
      status: Extract<StockBulkItemStatus, 'SUCCESS' | 'ERROR' | 'SKIPPED'>;
      result?: unknown;
      errorCode?: string;
      errorMessage?: string;
    }>,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.client()
      .from('mercadolibre_stock_bulk_job_items')
      .update({
        status: result.status,
        result: (result.result ?? null) as Json,
        error_code: result.errorCode?.slice(0, 100) ?? null,
        error_message: result.errorMessage?.slice(0, 500) ?? null,
        completed_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', id)
      .eq('status', 'PROCESSING')
      .select('id')
      .maybeSingle();
    if (error) this.persistenceError(error);
    if (!data) this.persistenceError(emptyResult('finalizar item'));
  }

  async retryItem(id: string, errorMessage: string): Promise<void> {
    const { data, error } = await this.client()
      .from('mercadolibre_stock_bulk_job_items')
      .update({
        status: 'PENDING',
        error_code: 'RETRYABLE_ERROR',
        error_message: errorMessage.slice(0, 500),
        processing_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'PROCESSING')
      .select('id')
      .maybeSingle();
    if (error) this.persistenceError(error);
    if (!data) this.persistenceError(emptyResult('reintentar item'));
  }

  async releaseForRetry(jobId: string): Promise<void> {
    const { error } = await this.client()
      .from('mercadolibre_stock_bulk_jobs')
      .update({
        status: 'QUEUED',
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'RUNNING');
    if (error) this.persistenceError(error);
  }

  async failJob(
    jobId: string,
    currentItemId: string,
    message: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const { error: itemError } = await this.client()
      .from('mercadolibre_stock_bulk_job_items')
      .update({
        status: 'PENDING',
        error_code: 'AUTHORIZATION_STOPPED',
        error_message: message.slice(0, 500),
        processing_started_at: null,
        updated_at: timestamp,
      })
      .eq('id', currentItemId)
      .eq('status', 'PROCESSING');
    const { error: jobError } = await this.client()
      .from('mercadolibre_stock_bulk_jobs')
      .update({
        status: 'FAILED',
        error_message: message.slice(0, 500),
        locked_at: null,
        completed_at: timestamp,
        updated_at: timestamp,
      })
      .eq('id', jobId)
      .eq('status', 'RUNNING');
    if (itemError) this.persistenceError(itemError);
    if (jobError) this.persistenceError(jobError);
  }

  async refreshProgress(id: string): Promise<StockBulkJob> {
    const items = await this.listItems(id);
    const successfulItems = count(items, 'SUCCESS');
    const failedItems = count(items, 'ERROR');
    const skippedItems = count(items, 'SKIPPED');
    const processedItems = successfulItems + failedItems + skippedItems;
    const hasMore = processedItems < items.length;
    const timestamp = new Date().toISOString();
    const status = hasMore
      ? ('QUEUED' as const)
      : failedItems > 0
        ? ('COMPLETED_WITH_ERRORS' as const)
        : ('COMPLETED' as const);
    const { data, error } = await this.client()
      .from('mercadolibre_stock_bulk_jobs')
      .update({
        status,
        processed_items: processedItems,
        successful_items: successfulItems,
        failed_items: failedItems,
        skipped_items: skippedItems,
        locked_at: null,
        completed_at: hasMore ? null : timestamp,
        updated_at: timestamp,
      })
      .eq('id', id)
      .eq('status', 'RUNNING')
      .select('*')
      .single();
    if (error) this.persistenceError(error);
    if (!data) this.persistenceError(emptyResult('actualizar progreso'));
    return data;
  }

  async retryErrors(id: string): Promise<number> {
    const { data, error } = await this.client().rpc(
      'retry_mercadolibre_stock_bulk_errors',
      { p_job_id: id },
    );
    if (error) this.persistenceError(error);
    if (typeof data !== 'number') {
      this.persistenceError(emptyResult('reintentar errores'));
    }
    return data;
  }

  private client(): SupabaseClient<StockBulkDatabase> {
    return this.supabaseService.getClient() as unknown as SupabaseClient<StockBulkDatabase>;
  }

  private persistenceError(error: SupabasePersistenceError): never {
    throw new ServiceUnavailableException({
      message: 'No se pudo persistir el job de stock masivo',
      supabase: {
        code: safeErrorField(error.code),
        message: safeErrorField(error.message),
        details: safeErrorField(error.details),
        hint: safeErrorField(error.hint),
      },
    });
  }
}

function emptyResult(operation: string): SupabasePersistenceError {
  return {
    code: 'EMPTY_SUPABASE_RESULT',
    message: `Supabase no devolvi\u00f3 datos al ${operation}`,
    details: null,
    hint: 'Verificar que la fila exista y coincida con el estado esperado',
  };
}

function safeErrorField(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 1_000)
    : null;
}

function count(
  items: readonly StockBulkJobItem[],
  status: StockBulkItemStatus,
) {
  return items.filter((item) => item.status === status).length;
}
