import { ServiceUnavailableException } from '@nestjs/common';

import type { SupabaseService } from '../../../database/supabase.service';
import { StockBulkJobRepository } from './stock-bulk-job.repository';
import type { StockBulkTarget } from './stock-bulk.types';

const JOB_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('StockBulkJobRepository', () => {
  it('crea at\u00f3micamente cabecera y 30 items, incluyendo quantity 0 y nulls', async () => {
    const persisted = { jobs: [] as unknown[], items: [] as unknown[] };
    const rpc = jest.fn(
      (
        functionName: string,
        args: {
          p_job_id: string;
          p_user_id: string;
          p_seller_id: number;
          p_targets: StockBulkTarget[];
        },
      ) => {
        expect(functionName).toBe('create_mercadolibre_stock_bulk_job');
        persisted.jobs.push({
          id: args.p_job_id,
          user_id: args.p_user_id,
          seller_id: args.p_seller_id,
          status: 'QUEUED',
          total_items: args.p_targets.length,
          processed_items: 0,
          successful_items: 0,
          failed_items: 0,
          skipped_items: 0,
          completed_at: null,
        });
        persisted.items.push(
          ...args.p_targets.map((target, position) => ({
            job_id: args.p_job_id,
            position,
            item_id: target.itemId,
            user_product_id: target.userProductId,
            variation_id: target.variationId,
            model: target.model,
            size: target.size,
            old_quantity: target.currentQuantity,
            new_quantity: target.requestedQuantity,
            old_status: target.currentStatus,
            status: 'PENDING',
            error_code: null,
            error_message: null,
          })),
        );
        return Promise.resolve({ data: args.p_job_id, error: null });
      },
    );
    const repository = repositoryWith({ rpc });
    const targets = Array.from({ length: 30 }, (_, index) => target(index));

    await repository.create({
      id: JOB_ID,
      userId: USER_ID,
      sellerId: 42,
      targets,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(persisted.jobs).toEqual([
      expect.objectContaining({
        id: JOB_ID,
        user_id: USER_ID,
        seller_id: 42,
        status: 'QUEUED',
        total_items: 30,
      }),
    ]);
    expect(persisted.items).toHaveLength(30);
    expect(persisted.items[0]).toEqual(
      expect.objectContaining({
        job_id: JOB_ID,
        item_id: 'MLA1000',
        user_product_id: null,
        variation_id: null,
        old_quantity: 0,
        new_quantity: 0,
        old_status: null,
        status: 'PENDING',
        error_code: null,
        error_message: null,
      }),
    );
  });

  it('preserva el error seguro de Supabase y no deja datos parciales', async () => {
    const persisted = { jobs: [] as unknown[], items: [] as unknown[] };
    const supabaseError = {
      code: 'PGRST202',
      message: 'Could not find the function in the schema cache',
      details: 'No matching function was found',
      hint: 'Apply the pending migration',
    };
    const repository = repositoryWith({
      rpc: jest.fn().mockResolvedValue({ data: null, error: supabaseError }),
    });

    const thrown = await repository
      .create({
        id: JOB_ID,
        userId: USER_ID,
        sellerId: 42,
        targets: [target(0)],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as ServiceUnavailableException).getResponse()).toEqual({
      message: 'No se pudo persistir el job de stock masivo',
      supabase: supabaseError,
    });
    expect(persisted).toEqual({ jobs: [], items: [] });
  });
});

function repositoryWith(client: { rpc: jest.Mock }): StockBulkJobRepository {
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  };
  return new StockBulkJobRepository(supabase as unknown as SupabaseService);
}

function target(index: number): StockBulkTarget {
  if (index === 0) {
    return {
      identifier: 'MLA1000',
      title: null,
      color: null,
      size: '40',
      itemId: 'MLA1000',
      userProductId: null,
      variationId: null,
      familyId: null,
      model: 'LEGACY',
      currentQuantity: 0,
      requestedQuantity: 0,
      currentStatus: null,
      needsChange: false,
      editable: true,
    };
  }
  return {
    identifier: `MLAU${1000 + index}`,
    title: `Buzo ${index}`,
    color: index % 2 ? 'Negro' : null,
    size: String(40 + (index % 3) * 2),
    itemId: `MLA${1000 + index}`,
    userProductId: `MLAU${1000 + index}`,
    variationId: null,
    familyId: String(2000 + index),
    model: 'USER_PRODUCT',
    currentQuantity: index,
    requestedQuantity: index + 1,
    currentStatus: index % 2 ? 'active' : 'paused',
    needsChange: true,
    editable: true,
  };
}
