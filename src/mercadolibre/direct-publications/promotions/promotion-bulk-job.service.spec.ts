import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';

import type { PromotionBulkJobRepository } from './promotion-bulk-job.repository';
import { PromotionBulkJobService } from './promotion-bulk-job.service';
import type {
  PromotionBulkJob,
  PromotionBulkJobItem,
} from './promotion-bulk-job.types';
import type { PublicationPromotionService } from './publication-promotion.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

describe('PromotionBulkJobService', () => {
  it.each([
    ['pending', 'SCHEDULED'],
    ['started', 'ACTIVE'],
  ] as const)('normaliza %s como %s', async (promotionStatus, status) => {
    const dependencies = setup([item('MLA1')], [job({ status: 'COMPLETED' })]);
    dependencies.publication.apply.mockResolvedValue(
      successResult('MLA1', promotionStatus),
    );

    await expect(
      dependencies.service.processNext(USER_ID, JOB_ID),
    ).resolves.toEqual({ hasMore: false });

    expect(dependencies.repository.finishItem).toHaveBeenCalledWith(
      'ITEM-MLA1',
      {
        status,
      },
    );
  });

  it('continúa después de un error y finaliza mixto con errores', async () => {
    const dependencies = setup(
      [item('MLA1'), item('MLA2', 1)],
      [job({ status: 'QUEUED' }), job({ status: 'COMPLETED_WITH_ERRORS' })],
    );
    dependencies.publication.apply
      .mockResolvedValueOnce({
        success: false,
        status: 'FAILURE',
        errorCode: 'PROMOTION_APPLICATION_FAILED',
        providerMessage: 'invalid deal price',
        totalItems: 1,
        successfulItems: 0,
        failedItems: 1,
        results: [],
      })
      .mockResolvedValueOnce(successResult('MLA2', 'started'));

    await expect(
      dependencies.service.processNext(USER_ID, JOB_ID),
    ).resolves.toEqual({ hasMore: true });
    await expect(
      dependencies.service.processNext(USER_ID, JOB_ID),
    ).resolves.toEqual({ hasMore: false });

    expect(dependencies.publication.apply).toHaveBeenCalledTimes(2);
    expect(dependencies.repository.finishItem).toHaveBeenNthCalledWith(
      1,
      'ITEM-MLA1',
      {
        status: 'ERROR',
        errorCode: 'PROMOTION_APPLICATION_FAILED',
        providerMessage: 'invalid deal price',
      },
    );
    expect(dependencies.repository.finishItem).toHaveBeenNthCalledWith(
      2,
      'ITEM-MLA2',
      { status: 'ACTIVE' },
    );
  });

  it('difiere una entrega duplicada mientras otro worker conserva el lock', async () => {
    const dependencies = setup([], []);
    dependencies.repository.claimJob.mockResolvedValue(false);

    await expect(
      dependencies.service.processNext(USER_ID, JOB_ID),
    ).resolves.toEqual({ hasMore: true, retryAfterSeconds: 15 });

    expect(dependencies.repository.claimNextItem).not.toHaveBeenCalled();
    expect(dependencies.publication.apply).not.toHaveBeenCalled();
  });
});

function setup(
  items: PromotionBulkJobItem[],
  refreshedJobs: PromotionBulkJob[],
) {
  const repository = {
    create: jest.fn(),
    findJob: jest.fn().mockResolvedValue(job()),
    listItems: jest.fn(),
    claimJob: jest.fn().mockResolvedValue(true),
    claimNextItem: jest.fn(),
    finishItem: jest.fn().mockResolvedValue(undefined),
    refreshProgress: jest.fn(),
  };
  for (const value of items)
    repository.claimNextItem.mockResolvedValueOnce(value);
  for (const value of refreshedJobs)
    repository.refreshProgress.mockResolvedValueOnce(value);
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
  };
  const publication = { apply: jest.fn() };
  return {
    service: new PromotionBulkJobService(
      repository as unknown as PromotionBulkJobRepository,
      token as unknown as MercadolibreTokenService,
      publication as unknown as PublicationPromotionService,
    ),
    repository,
    publication,
  };
}

function job(overrides: Partial<PromotionBulkJob> = {}): PromotionBulkJob {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    seller_id: 42,
    status: 'QUEUED',
    total_items: 2,
    processed_items: 0,
    successful_items: 0,
    failed_items: 0,
    locked_at: null,
    started_at: null,
    finished_at: null,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    ...overrides,
  };
}

function item(itemId: string, position = 0): PromotionBulkJobItem {
  return {
    id: `ITEM-${itemId}`,
    job_id: JOB_ID,
    position,
    item_id: itemId,
    request: {
      type: 'DEAL',
      promotionId: 'P-1',
      dealPrice: 80,
    },
    status: 'PROCESSING',
    error_code: null,
    provider_message: null,
    processing_started_at: '2026-08-29T00:00:00Z',
    finished_at: null,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  };
}

function successResult(itemId: string, promotionStatus: 'pending' | 'started') {
  return {
    success: true,
    status: 'SUCCESS' as const,
    totalItems: 1,
    successfulItems: 1,
    failedItems: 0,
    results: [
      {
        itemId,
        success: true,
        stage: 'COMPLETED' as const,
        promotionStatus,
      },
    ],
  };
}
