import { BadRequestException } from '@nestjs/common';

import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { StockService } from '../stock/stock.service';
import { StockBulkErrorPolicy } from './stock-bulk-error-policy';
import type { StockBulkJobRepository } from './stock-bulk-job.repository';
import { StockBulkJobService } from './stock-bulk-job.service';
import type { StockBulkJob, StockBulkJobItem } from './stock-bulk.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

describe('StockBulkJobService', () => {
  it('persiste el job antes de devolverlo', async () => {
    const dependencies = setup([], []);
    const targets = [
      {
        identifier: 'MLA1',
        title: null,
        color: null,
        size: '40',
        itemId: 'MLA1',
        userProductId: null,
        variationId: null,
        familyId: null,
        model: 'LEGACY' as const,
        currentQuantity: 0,
        requestedQuantity: 2,
        currentStatus: 'active',
        needsChange: true,
        editable: true,
      },
    ];

    const result = await dependencies.service.start(USER_ID, targets);

    expect(dependencies.repository.create).toHaveBeenCalledWith({
      id: result.jobId,
      userId: USER_ID,
      sellerId: 42,
      targets,
    });
    expect(typeof result.jobId).toBe('string');
    expect(result).toEqual({
      jobId: result.jobId,
      status: 'QUEUED',
      totalItems: 1,
    });
  });

  it('marca SKIPPED sin llamar a Mercado Libre cuando no hay cambios', async () => {
    const dependencies = setup(
      [item({ old_quantity: 4, new_quantity: 4 })],
      [job({ status: 'COMPLETED', processed_items: 1, skipped_items: 1 })],
    );

    await expect(
      dependencies.service.processNext(USER_ID, JOB_ID),
    ).resolves.toEqual({ hasMore: false });

    expect(dependencies.repository.finishItem).toHaveBeenCalledWith('ITEM-1', {
      status: 'SKIPPED',
      result: { reason: 'UNCHANGED' },
    });
    expect(dependencies.stock.updateNew).not.toHaveBeenCalled();
    expect(dependencies.stock.updateClassic).not.toHaveBeenCalled();
  });

  it('usa StockService.updateNew para USER_PRODUCT', async () => {
    const dependencies = setup(
      [item({ model: 'USER_PRODUCT' })],
      [job({ status: 'COMPLETED', processed_items: 1, successful_items: 1 })],
    );
    dependencies.stock.updateNew.mockResolvedValue({ updated: true });

    await dependencies.service.processNext(USER_ID, JOB_ID);

    expect(dependencies.stock.updateNew).toHaveBeenCalledWith(
      USER_ID,
      '100',
      'MLA1',
      { quantity: 2 },
    );
    expect(dependencies.repository.finishItem).toHaveBeenCalledWith('ITEM-1', {
      status: 'SUCCESS',
      result: { updated: true },
    });
  });

  it('usa StockService.updateClassic para LEGACY', async () => {
    const dependencies = setup(
      [
        item({
          model: 'LEGACY',
          user_product_id: null,
          family_id: null,
          variation_id: '200',
        }),
      ],
      [job({ status: 'COMPLETED', processed_items: 1, successful_items: 1 })],
    );
    dependencies.stock.updateClassic.mockResolvedValue({ updated: true });

    await dependencies.service.processNext(USER_ID, JOB_ID);

    expect(dependencies.stock.updateClassic).toHaveBeenCalledWith(
      USER_ID,
      'MLA1',
      { quantity: 2, variationId: 200 },
    );
  });

  it('a\u00edsla un error 400 y procesa el siguiente target', async () => {
    const dependencies = setup(
      [item(), item({ id: 'ITEM-2', item_id: 'MLA2', position: 1 })],
      [
        job({ status: 'QUEUED', processed_items: 1, failed_items: 1 }),
        job({
          status: 'COMPLETED_WITH_ERRORS',
          processed_items: 2,
          successful_items: 1,
          failed_items: 1,
        }),
      ],
    );
    dependencies.stock.updateNew
      .mockRejectedValueOnce(new BadRequestException('target inv\u00e1lido'))
      .mockResolvedValueOnce({ updated: true });

    await expect(
      dependencies.service.processNext(USER_ID, JOB_ID),
    ).resolves.toEqual({ hasMore: true });
    await expect(
      dependencies.service.processNext(USER_ID, JOB_ID),
    ).resolves.toEqual({ hasMore: false });

    expect(dependencies.stock.updateNew).toHaveBeenCalledTimes(2);
    expect(dependencies.repository.finishItem).toHaveBeenNthCalledWith(
      1,
      'ITEM-1',
      {
        status: 'ERROR',
        errorCode: 'STOCK_UPDATE_FAILED',
        errorMessage: 'target inv\u00e1lido',
      },
    );
    expect(dependencies.repository.finishItem).toHaveBeenNthCalledWith(
      2,
      'ITEM-2',
      { status: 'SUCCESS', result: { updated: true } },
    );
  });

  it('devuelve progreso, porcentaje e items persistidos', async () => {
    const dependencies = setup([], []);
    dependencies.repository.findJob.mockResolvedValue(
      job({
        status: 'COMPLETED_WITH_ERRORS',
        total_items: 4,
        processed_items: 3,
        successful_items: 1,
        failed_items: 1,
        skipped_items: 1,
      }),
    );
    dependencies.repository.listItems.mockResolvedValue([
      item({ status: 'SUCCESS' }),
    ]);

    const result = await dependencies.service.getStatus(USER_ID, JOB_ID);

    expect(result).toEqual(
      expect.objectContaining({
        totalItems: 4,
        processedItems: 3,
        successfulItems: 1,
        failedItems: 1,
        skippedItems: 1,
        percent: 75,
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        itemId: 'MLA1',
        model: 'USER_PRODUCT',
        previousQuantity: 1,
        requestedQuantity: 2,
        status: 'SUCCESS',
      }),
    );
  });
});

function setup(items: StockBulkJobItem[], refreshedJobs: StockBulkJob[]) {
  const repository = {
    create: jest.fn(),
    findJob: jest.fn().mockResolvedValue(job()),
    listItems: jest.fn().mockResolvedValue([]),
    claimJob: jest.fn().mockResolvedValue(true),
    claimNextItem: jest.fn(),
    finishItem: jest.fn().mockResolvedValue(undefined),
    retryItem: jest.fn().mockResolvedValue(undefined),
    releaseForRetry: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
    refreshProgress: jest.fn(),
    retryErrors: jest.fn(),
  };
  for (const value of items)
    repository.claimNextItem.mockResolvedValueOnce(value);
  for (const value of refreshedJobs)
    repository.refreshProgress.mockResolvedValueOnce(value);
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
  };
  const stock = {
    updateNew: jest.fn(),
    updateClassic: jest.fn(),
  };
  return {
    service: new StockBulkJobService(
      repository as unknown as StockBulkJobRepository,
      token as unknown as MercadolibreTokenService,
      stock as unknown as StockService,
      new StockBulkErrorPolicy(),
    ),
    repository,
    stock,
  };
}

function job(overrides: Partial<StockBulkJob> = {}): StockBulkJob {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    seller_id: 42,
    status: 'QUEUED',
    total_items: 1,
    processed_items: 0,
    successful_items: 0,
    failed_items: 0,
    skipped_items: 0,
    locked_at: null,
    started_at: null,
    completed_at: null,
    error_message: null,
    created_at: '2026-09-22T00:00:00Z',
    updated_at: '2026-09-22T00:00:00Z',
    ...overrides,
  };
}

function item(overrides: Partial<StockBulkJobItem> = {}): StockBulkJobItem {
  return {
    id: 'ITEM-1',
    job_id: JOB_ID,
    position: 0,
    identifier: 'MLAU1',
    title: 'Buzo Mujer',
    color: 'Negro',
    size: '40',
    item_id: 'MLA1',
    user_product_id: 'MLAU1',
    variation_id: null,
    family_id: '100',
    model: 'USER_PRODUCT',
    old_quantity: 1,
    new_quantity: 2,
    old_status: 'active',
    store_id: null,
    network_node_id: null,
    editable: true,
    reason: null,
    status: 'PROCESSING',
    attempt_count: 1,
    result: null,
    error_code: null,
    error_message: null,
    processing_started_at: '2026-09-22T00:00:00Z',
    completed_at: null,
    created_at: '2026-09-22T00:00:00Z',
    updated_at: '2026-09-22T00:00:00Z',
    ...overrides,
  };
}
