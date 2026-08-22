import { HttpException, Logger } from '@nestjs/common';
import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncService } from './publication-sync.service';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const FULL_SYNC_ID = '22222222-2222-4222-8222-222222222222';
const APP_USER_ID = '33333333-3333-4333-8333-333333333333';

/** Crea un job reclamado con el contador solicitado. */
function job(retryCount: number, status: MercadolibreSyncJob['status']) {
  return {
    id: JOB_ID,
    seller_id: 123,
    full_sync_id: FULL_SYNC_ID,
    status,
    scan_started: true,
    scroll_id: 'scroll-1',
    buffer_item_ids: ['MLA1'],
    processed_items: 0,
    products_saved: 0,
    children_saved: 0,
    errors_count: 0,
    retry_count: retryCount,
    last_error: null,
    started_at: '2026-08-10T12:00:00.000Z',
    finished_at: null,
    created_at: '2026-08-10T12:00:00.000Z',
    updated_at: '2026-08-10T12:00:00.000Z',
  } satisfies MercadolibreSyncJob;
}

/** Crea el servicio para provocar un error HTTP durante syncBatch. */
function setup(retryCount: number, failure: number | Error) {
  const pending = job(retryCount, 'PENDING');
  const running = job(retryCount, 'RUNNING');
  const jobs = {
    findById: jest.fn().mockResolvedValue(pending),
    claim: jest.fn().mockResolvedValue(running),
    releaseAfterError: jest.fn().mockResolvedValue(pending),
    fail: jest.fn().mockResolvedValue(job(retryCount, 'FAILED')),
  };
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({
      user_id: APP_USER_ID,
      seller_id: 123,
    }),
    getValidAccessToken: jest.fn().mockResolvedValue('private-token'),
  };
  const source = { fetchNextScanPage: jest.fn() };
  const sync = {
    syncBatch: jest
      .fn()
      .mockRejectedValue(
        typeof failure === 'number'
          ? new HttpException('access_token=private-token', failure)
          : failure,
      ),
  };
  const service = new PublicationSyncJobService(
    jobs as unknown as MercadolibreSyncJobsRepository,
    token as unknown as MercadolibreTokenService,
    source as unknown as PublicationSourceService,
    sync as unknown as PublicationSyncService,
  );
  return { jobs, service };
}

describe('PublicationSyncJobService retries', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([429, 500, 502, 503, 504])(
    'libera el primer error temporal HTTP %s',
    async (status) => {
      const { jobs, service } = setup(0, status);
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      await expect(
        service.processNext(APP_USER_ID, JOB_ID),
      ).rejects.toMatchObject({
        status,
      });

      expect(jobs.releaseAfterError).toHaveBeenCalledWith(
        JOB_ID,
        expect.any(String),
        1,
      );
      expect(jobs.fail).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
      expect(JSON.stringify(jobs.releaseAfterError.mock.calls)).not.toContain(
        'private-token',
      );
    },
  );

  it('permite el tercer reintento consecutivo', async () => {
    const { jobs, service } = setup(2, 503);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(
      service.processNext(APP_USER_ID, JOB_ID),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(jobs.releaseAfterError).toHaveBeenCalledWith(
      JOB_ID,
      expect.any(String),
      3,
    );
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('libera un rate limit identificado por su mensaje', async () => {
    const failure = new Error('Demasiadas solicitudes');
    const { jobs, service } = setup(0, failure);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(service.processNext(APP_USER_ID, JOB_ID)).rejects.toBe(
      failure,
    );

    expect(jobs.releaseAfterError).toHaveBeenCalledWith(
      JOB_ID,
      'Mercado Libre limitó temporalmente las solicitudes',
      1,
    );
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('marca FAILED cuando el error supera tres reintentos', async () => {
    const { jobs, service } = setup(3, 503);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(
      service.processNext(APP_USER_ID, JOB_ID),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(jobs.fail).toHaveBeenCalledWith(JOB_ID, expect.any(String));
    expect(jobs.releaseAfterError).not.toHaveBeenCalled();
  });
});
