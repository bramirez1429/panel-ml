import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncService } from './publication-sync.service';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const FULL_SYNC_ID = '22222222-2222-4222-8222-222222222222';
const STARTED_AT = '2026-08-10T12:00:00.000Z';
const SELLER_ID = 123;

/** Crea un trabajo completo con valores predeterminados. */
function job(
  overrides: Partial<MercadolibreSyncJob> = {},
): MercadolibreSyncJob {
  return {
    id: JOB_ID,
    seller_id: SELLER_ID,
    full_sync_id: FULL_SYNC_ID,
    status: 'PENDING',
    scan_started: false,
    scroll_id: null,
    buffer_item_ids: [],
    processed_items: 0,
    products_saved: 0,
    children_saved: 0,
    errors_count: 0,
    last_error: null,
    started_at: null,
    finished_at: null,
    created_at: STARTED_AT,
    updated_at: STARTED_AT,
    ...overrides,
  };
}

/** Genera MLA consecutivos para simular una página. */
function itemIds(amount: number): string[] {
  return Array.from({ length: amount }, (_, index) => `MLA${index + 1}`);
}

/** Crea el servicio con todas sus dependencias controladas. */
function setup() {
  const jobs = {
    create: jest.fn().mockResolvedValue(job()),
    findById: jest.fn().mockResolvedValue(job()),
    claim: jest
      .fn()
      .mockResolvedValue(job({ status: 'RUNNING', started_at: STARTED_AT })),
    updateProgress: jest.fn().mockResolvedValue(job()),
    complete: jest.fn().mockResolvedValue(job({ status: 'COMPLETED' })),
    fail: jest.fn().mockResolvedValue(job({ status: 'FAILED' })),
  };
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: SELLER_ID }),
    getValidAccessToken: jest.fn().mockResolvedValue('private-token'),
  };
  const source = {
    fetchNextScanPage: jest.fn(),
  };
  const sync = {
    syncBatch: jest.fn(),
    finalizeFullSync: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PublicationSyncJobService(
    jobs as unknown as MercadolibreSyncJobsRepository,
    token as unknown as MercadolibreTokenService,
    source as unknown as PublicationSourceService,
    sync as unknown as PublicationSyncService,
  );
  return { jobs, service, source, sync, token };
}

describe('PublicationSyncJobService', () => {
  it('crea el job sin consultar Mercado Libre ni pedir un token válido', async () => {
    const { jobs, service, source, sync, token } = setup();
    await expect(service.start()).resolves.toEqual({
      ok: true,
      syncId: JOB_ID,
      status: 'PENDING',
    });
    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(token.getValidAccessToken).not.toHaveBeenCalled();
    expect(source.fetchNextScanPage).not.toHaveBeenCalled();
    expect(sync.syncBatch).not.toHaveBeenCalled();
  });

  it('trae una página, procesa diez y luego consume el buffer', async () => {
    const { jobs, service, source, sync } = setup();
    const ids = itemIds(100);
    const running = job({ status: 'RUNNING', started_at: STARTED_AT });
    const afterFirst = job({
      scan_started: true,
      scroll_id: 'scroll-1',
      buffer_item_ids: ids.slice(10),
      processed_items: 10,
      products_saved: 6,
      children_saved: 4,
      started_at: STARTED_AT,
    });
    const afterSecond = job({
      ...afterFirst,
      buffer_item_ids: ids.slice(20),
      processed_items: 20,
      products_saved: 11,
      children_saved: 9,
    });
    jobs.findById
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(afterFirst);
    jobs.claim
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(job({ ...afterFirst, status: 'RUNNING' }));
    jobs.updateProgress
      .mockResolvedValueOnce(afterFirst)
      .mockResolvedValueOnce(afterSecond);
    source.fetchNextScanPage.mockResolvedValue({
      itemIds: ids,
      scrollId: 'scroll-1',
    });
    sync.syncBatch
      .mockResolvedValueOnce({ productsSaved: 6, childrenSaved: 4, errors: [] })
      .mockResolvedValueOnce({
        productsSaved: 5,
        childrenSaved: 5,
        errors: [],
      });
    await service.processNext(JOB_ID);
    const second = await service.processNext(JOB_ID);
    expect(source.fetchNextScanPage).toHaveBeenCalledTimes(1);
    expect(sync.syncBatch).toHaveBeenNthCalledWith(
      1,
      ids.slice(0, 10),
      { sellerId: SELLER_ID, accessToken: 'private-token' },
      FULL_SYNC_ID,
    );
    expect(sync.syncBatch).toHaveBeenNthCalledWith(
      2,
      ids.slice(10, 20),
      expect.any(Object),
      FULL_SYNC_ID,
    );
    expect(second).toMatchObject({
      status: 'PENDING',
      processedThisBatch: 10,
      processedItems: 20,
      hasMore: true,
    });
  });

  it('finaliza y limpia solamente al recibir la página terminal', async () => {
    const { jobs, service, source, sync } = setup();
    source.fetchNextScanPage.mockResolvedValue({ itemIds: [], scrollId: null });
    await expect(service.processNext(JOB_ID)).resolves.toMatchObject({
      status: 'COMPLETED',
      hasMore: false,
    });
    expect(sync.finalizeFullSync).toHaveBeenCalledWith(
      SELLER_ID,
      FULL_SYNC_ID,
      STARTED_AT,
    );
    expect(jobs.complete).toHaveBeenCalledWith(JOB_ID);
    expect(jobs.updateProgress).not.toHaveBeenCalled();
  });

  it('marca FAILED ante una falla fatal y no ejecuta cleanup', async () => {
    const { jobs, service, sync } = setup();
    jobs.findById.mockResolvedValue(job({ buffer_item_ids: ['MLA1'] }));
    jobs.claim.mockResolvedValue(
      job({
        status: 'RUNNING',
        buffer_item_ids: ['MLA1'],
        started_at: STARTED_AT,
      }),
    );
    sync.syncBatch.mockRejectedValue(
      new BadGatewayException('access_token=private-token'),
    );
    await expect(service.processNext(JOB_ID)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(jobs.fail).toHaveBeenCalledWith(
      JOB_ID,
      'Un servicio externo impidió continuar',
    );
    expect(JSON.stringify(jobs.fail.mock.calls)).not.toContain('private-token');
    expect(sync.finalizeFullSync).not.toHaveBeenCalled();
  });

  it('no marca FAILED si falla el estado después del cleanup', async () => {
    const { jobs, service, source, sync } = setup();
    source.fetchNextScanPage.mockResolvedValue({ itemIds: [], scrollId: null });
    jobs.complete.mockRejectedValue(
      new BadGatewayException('No se pudo completar'),
    );

    await expect(service.processNext(JOB_ID)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(sync.finalizeFullSync).toHaveBeenCalledTimes(1);
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('acumula errores individuales y mantiene el job pendiente', async () => {
    const { jobs, service, sync } = setup();
    const ids = itemIds(10);
    const current = job({
      buffer_item_ids: ids,
      errors_count: 2,
      processed_items: 20,
    });
    jobs.findById.mockResolvedValue(current);
    jobs.claim.mockResolvedValue(
      job({ ...current, status: 'RUNNING', started_at: STARTED_AT }),
    );
    jobs.updateProgress.mockResolvedValue(
      job({ processed_items: 30, errors_count: 3, started_at: STARTED_AT }),
    );
    sync.syncBatch.mockResolvedValue({
      productsSaved: 4,
      childrenSaved: 5,
      errors: [{ itemId: 'MLA3', message: 'No encontrado' }],
    });
    await expect(service.processNext(JOB_ID)).resolves.toMatchObject({
      status: 'PENDING',
      processedItems: 30,
      errorsCount: 3,
    });
    expect(jobs.updateProgress).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ processedItems: 30, errorsCount: 3 }),
    );
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('rechaza jobs de otro vendedor antes de reclamarlos', async () => {
    const { jobs, service } = setup();
    jobs.findById.mockResolvedValue(job({ seller_id: 999 }));
    await expect(service.processNext(JOB_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(jobs.claim).not.toHaveBeenCalled();
  });
});
