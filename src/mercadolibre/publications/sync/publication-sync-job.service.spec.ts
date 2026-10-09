import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncService } from './publication-sync.service';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const FULL_SYNC_ID = '22222222-2222-4222-8222-222222222222';
const APP_USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_APP_USER_ID = '44444444-4444-4444-8444-444444444444';
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
    total_items: 0,
    processed_items: 0,
    successful_items: 0,
    failed_items: 0,
    products_saved: 0,
    children_saved: 0,
    errors_count: 0,
    retry_count: 0,
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
  const connection = { user_id: APP_USER_ID, seller_id: SELLER_ID };
  const jobs = {
    create: jest.fn().mockResolvedValue(job()),
    findActiveBySellerId: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(job()),
    claim: jest
      .fn()
      .mockResolvedValue(job({ status: 'RUNNING', started_at: STARTED_AT })),
    updateProgress: jest.fn().mockResolvedValue(job()),
    failWithProgress: jest.fn().mockResolvedValue(job({ status: 'FAILED' })),
    releaseAfterError: jest.fn().mockResolvedValue(job()),
    complete: jest.fn().mockResolvedValue(job({ status: 'COMPLETED' })),
    cancel: jest.fn().mockResolvedValue(job({ status: 'CANCELLED' })),
    fail: jest.fn().mockResolvedValue(job({ status: 'FAILED' })),
  };
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue(connection),
    getValidAccessToken: jest.fn().mockResolvedValue('private-token'),
  };
  const source = {
    fetchNextScanPage: jest.fn(),
    getItemsTotal: jest.fn().mockResolvedValue(42),
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
  return { connection, jobs, service, source, sync, token };
}
describe('PublicationSyncJobService', () => {
  it('crea el job sin consultar Mercado Libre ni pedir un token válido', async () => {
    const { jobs, service, source, sync, token } = setup();
    await expect(service.start(APP_USER_ID)).resolves.toEqual({
      ok: true,
      syncId: JOB_ID,
      status: 'PENDING',
      totalItems: 0,
      processedItems: 0,
      productsSaved: 0,
      childrenSaved: 0,
      errorsCount: 0,
      lastError: null,
      hasMore: true,
    });
    expect(token.getStoredConnection).toHaveBeenCalledWith(APP_USER_ID);
    expect(jobs.findActiveBySellerId).toHaveBeenCalledWith(SELLER_ID);
    expect(jobs.create).toHaveBeenCalledTimes(1);
    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: SELLER_ID, totalItems: 42 }),
    );
    expect(token.getValidAccessToken).toHaveBeenCalledWith(
      APP_USER_ID,
      expect.any(Object),
    );
    expect(source.getItemsTotal).toHaveBeenCalledWith(
      SELLER_ID,
      'private-token',
    );
    expect(source.fetchNextScanPage).not.toHaveBeenCalled();
    expect(sync.syncBatch).not.toHaveBeenCalled();
  });

  it('reutiliza el job activo del seller sin crear ni consultar el total', async () => {
    const { jobs, service, source, token } = setup();
    jobs.findActiveBySellerId.mockResolvedValue(
      job({ status: 'RUNNING', total_items: 75 }),
    );

    await expect(service.start(APP_USER_ID)).resolves.toEqual({
      ok: true,
      syncId: JOB_ID,
      status: 'RUNNING',
      totalItems: 75,
      processedItems: 0,
      productsSaved: 0,
      childrenSaved: 0,
      errorsCount: 0,
      lastError: null,
      hasMore: true,
    });

    expect(jobs.create).not.toHaveBeenCalled();
    expect(token.getValidAccessToken).not.toHaveBeenCalled();
    expect(source.getItemsTotal).not.toHaveBeenCalled();
  });

  it('incluye el total real en el status del job', async () => {
    const { jobs, service } = setup();
    jobs.findById.mockResolvedValue(
      job({
        status: 'RUNNING',
        total_items: 100,
        processed_items: 25,
        successful_items: 23,
        failed_items: 2,
        products_saved: 10,
        children_saved: 15,
        errors_count: 2,
        last_error: 'Error temporal',
      }),
    );

    await expect(service.getStatus(APP_USER_ID, JOB_ID)).resolves.toEqual({
      ok: true,
      syncId: JOB_ID,
      status: 'RUNNING',
      totalItems: 100,
      processedItems: 25,
      productsSaved: 10,
      childrenSaved: 15,
      errorsCount: 2,
      lastError: 'Error temporal',
      hasMore: true,
    });
  });

  it('devuelve el trabajo activo del seller con el contrato de progreso', async () => {
    const { jobs, service } = setup();
    jobs.findActiveBySellerId.mockResolvedValue(
      job({
        status: 'RUNNING',
        total_items: 100,
        processed_items: 25,
        successful_items: 23,
        failed_items: 2,
        products_saved: 10,
        children_saved: 15,
        errors_count: 2,
        last_error: 'Error temporal',
      }),
    );

    await expect(service.getActive(APP_USER_ID)).resolves.toEqual({
      ok: true,
      syncId: JOB_ID,
      status: 'RUNNING',
      totalItems: 100,
      processedItems: 25,
      productsSaved: 10,
      childrenSaved: 15,
      errorsCount: 2,
      lastError: 'Error temporal',
      hasMore: true,
    });
    expect(jobs.findActiveBySellerId).toHaveBeenCalledWith(SELLER_ID);
  });

  it('devuelve null cuando el seller no tiene un trabajo activo', async () => {
    const { jobs, service } = setup();

    await expect(service.getActive(APP_USER_ID)).resolves.toBeNull();
    expect(jobs.findActiveBySellerId).toHaveBeenCalledWith(SELLER_ID);
  });

  it('trae una página, procesa diez y luego consume el buffer', async () => {
    const { connection, jobs, service, source, sync, token } = setup();
    const ids = itemIds(100);
    const running = job({ status: 'RUNNING', started_at: STARTED_AT });
    const afterFirst = job({
      scan_started: true,
      scroll_id: 'scroll-1',
      buffer_item_ids: ids.slice(10),
      processed_items: 10,
      successful_items: 10,
      failed_items: 0,
      products_saved: 6,
      children_saved: 4,
      started_at: STARTED_AT,
    });
    const afterSecond = job({
      ...afterFirst,
      buffer_item_ids: ids.slice(20),
      processed_items: 20,
      successful_items: 20,
      failed_items: 0,
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
    await service.processNext(APP_USER_ID, JOB_ID);
    const second = await service.processNext(APP_USER_ID, JOB_ID);
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
    expect(jobs.updateProgress).toHaveBeenNthCalledWith(
      1,
      JOB_ID,
      expect.objectContaining({
        processedItems: 10,
        successfulItems: 10,
        failedItems: 0,
      }),
    );
    expect(jobs.updateProgress).toHaveBeenNthCalledWith(
      2,
      JOB_ID,
      expect.objectContaining({
        processedItems: 20,
        successfulItems: 20,
        failedItems: 0,
      }),
    );
    expect(token.getValidAccessToken).toHaveBeenCalledWith(
      APP_USER_ID,
      connection,
    );
  });

  it('finaliza y limpia una sincronización completa sin errores', async () => {
    const { jobs, service, source, sync } = setup();
    const terminal = job({
      scan_started: true,
      total_items: 10,
      processed_items: 10,
      successful_items: 10,
      products_saved: 10,
      started_at: STARTED_AT,
    });
    jobs.findById.mockResolvedValue(terminal);
    jobs.claim.mockResolvedValue(job({ ...terminal, status: 'RUNNING' }));
    source.fetchNextScanPage.mockResolvedValue({ itemIds: [], scrollId: null });
    await expect(
      service.processNext(APP_USER_ID, JOB_ID),
    ).resolves.toMatchObject({
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

  it('detiene el primer lote completamente fallido sin encolar más avance', async () => {
    const { jobs, service, source, sync } = setup();
    const ids = itemIds(10);
    source.fetchNextScanPage.mockResolvedValue({
      itemIds: ids,
      scrollId: 'scroll-1',
    });
    sync.syncBatch.mockResolvedValue({
      productsSaved: 0,
      childrenSaved: 0,
      errors: ids.map((itemId) => ({ itemId, message: 'No encontrado' })),
      diagnostics: {
        sourceErrors: 10,
        sourceHttpStatuses: { 404: 10 },
        ownedErrors: 0,
        preparedErrors: 0,
        variantResultErrors: 0,
      },
    });
    jobs.failWithProgress.mockResolvedValue(
      job({
        status: 'FAILED',
        processed_items: 10,
        failed_items: 10,
        errors_count: 10,
        started_at: STARTED_AT,
      }),
    );

    await expect(service.processNext(APP_USER_ID, JOB_ID)).resolves.toEqual({
      ok: true,
      syncId: JOB_ID,
      status: 'FAILED',
      hasMore: false,
    });

    expect(jobs.failWithProgress).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        processedItems: 10,
        successfulItems: 0,
        failedItems: 10,
        errorsCount: 10,
      }),
      'El primer lote no pudo guardar ninguna publicación',
    );
    expect(jobs.updateProgress).not.toHaveBeenCalled();
    expect(sync.finalizeFullSync).not.toHaveBeenCalled();
  });

  it('no ejecuta cleanup cuando el scan termina con publicaciones fallidas', async () => {
    const { jobs, service, sync } = setup();
    const terminal = job({
      scan_started: true,
      total_items: 10,
      processed_items: 10,
      successful_items: 8,
      failed_items: 2,
      products_saved: 8,
      errors_count: 2,
      started_at: STARTED_AT,
    });
    jobs.findById.mockResolvedValue(terminal);
    jobs.claim.mockResolvedValue(job({ ...terminal, status: 'RUNNING' }));
    jobs.fail.mockResolvedValue(job({ ...terminal, status: 'FAILED' }));

    await expect(service.processNext(APP_USER_ID, JOB_ID)).resolves.toEqual({
      ok: true,
      syncId: JOB_ID,
      status: 'FAILED',
      hasMore: false,
    });

    expect(jobs.fail).toHaveBeenCalledWith(
      JOB_ID,
      'La sincronización finalizó con publicaciones fallidas',
    );
    expect(sync.finalizeFullSync).not.toHaveBeenCalled();
  });

  it('no ejecuta cleanup cuando el scan termina incompleto', async () => {
    const { jobs, service, sync } = setup();
    const terminal = job({
      scan_started: true,
      total_items: 10,
      processed_items: 9,
      successful_items: 9,
      products_saved: 9,
      started_at: STARTED_AT,
    });
    jobs.findById.mockResolvedValue(terminal);
    jobs.claim.mockResolvedValue(job({ ...terminal, status: 'RUNNING' }));
    jobs.fail.mockResolvedValue(job({ ...terminal, status: 'FAILED' }));

    await expect(service.processNext(APP_USER_ID, JOB_ID)).resolves.toEqual({
      ok: true,
      syncId: JOB_ID,
      status: 'FAILED',
      hasMore: false,
    });

    expect(jobs.fail).toHaveBeenCalledWith(
      JOB_ID,
      'La sincronización finalizó con publicaciones sin procesar',
    );
    expect(sync.finalizeFullSync).not.toHaveBeenCalled();
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
      new BadRequestException('access_token=private-token'),
    );
    await expect(
      service.processNext(APP_USER_ID, JOB_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.fail).toHaveBeenCalledWith(
      JOB_ID,
      'La sincronización no pudo continuar',
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

    await expect(
      service.processNext(APP_USER_ID, JOB_ID),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(sync.finalizeFullSync).toHaveBeenCalledTimes(1);
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('acumula dos publicaciones fallidas una sola vez ante errores duplicados', async () => {
    const { jobs, service, sync } = setup();
    const ids = itemIds(10);
    const current = job({
      buffer_item_ids: ids,
      errors_count: 2,
      processed_items: 20,
      successful_items: 18,
      failed_items: 2,
    });
    jobs.findById.mockResolvedValue(current);
    jobs.claim.mockResolvedValue(
      job({ ...current, status: 'RUNNING', started_at: STARTED_AT }),
    );
    jobs.updateProgress.mockResolvedValue(
      job({
        processed_items: 30,
        successful_items: 26,
        failed_items: 4,
        errors_count: 5,
        started_at: STARTED_AT,
      }),
    );
    sync.syncBatch.mockResolvedValue({
      productsSaved: 4,
      childrenSaved: 5,
      errors: [
        { itemId: 'MLA3', message: 'No encontrado' },
        { itemId: 'MLA3', message: 'Error duplicado' },
        { itemId: 'MLA7', message: 'No encontrado' },
      ],
    });
    await expect(
      service.processNext(APP_USER_ID, JOB_ID),
    ).resolves.toMatchObject({
      status: 'PENDING',
      processedItems: 30,
      errorsCount: 5,
    });
    expect(jobs.updateProgress).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        processedItems: 30,
        successfulItems: 26,
        failedItems: 4,
        errorsCount: 5,
      }),
    );
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('no contabiliza éxitos cuando un error no identifica la publicación', async () => {
    const { jobs, service, sync } = setup();
    const ids = itemIds(10);
    const current = job({ buffer_item_ids: ids });
    jobs.findById.mockResolvedValue(current);
    jobs.claim.mockResolvedValue(
      job({ ...current, status: 'RUNNING', started_at: STARTED_AT }),
    );
    jobs.updateProgress.mockResolvedValue(
      job({
        processed_items: 10,
        successful_items: 0,
        failed_items: 10,
        errors_count: 1,
        started_at: STARTED_AT,
      }),
    );
    sync.syncBatch.mockResolvedValue({
      productsSaved: 0,
      childrenSaved: 0,
      errors: [{ message: 'Error sin itemId' }],
    });

    await service.processNext(APP_USER_ID, JOB_ID);

    expect(jobs.updateProgress).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        processedItems: 10,
        successfulItems: 0,
        failedItems: 10,
      }),
    );
  });

  it('rechaza jobs de otro vendedor antes de reclamarlos', async () => {
    const { jobs, service } = setup();
    jobs.findById.mockResolvedValue(job({ seller_id: 999 }));
    await expect(
      service.processNext(APP_USER_ID, JOB_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(jobs.claim).not.toHaveBeenCalled();
  });

  it('no expone el estado de un job a un usuario conectado a otro seller', async () => {
    const { jobs, service, token } = setup();
    token.getStoredConnection.mockResolvedValue({
      user_id: OTHER_APP_USER_ID,
      seller_id: 999,
    });
    jobs.findById.mockResolvedValue(job({ seller_id: SELLER_ID }));

    await expect(
      service.getStatus(OTHER_APP_USER_ID, JOB_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(token.getStoredConnection).toHaveBeenCalledWith(OTHER_APP_USER_ID);
    expect(jobs.claim).not.toHaveBeenCalled();
  });
});
