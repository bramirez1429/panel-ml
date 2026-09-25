import type { SyncErrorRow } from '../../../database/database.types';
import { PublicationSyncRetryService } from './publication-sync-retry.service';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

function storedError(id: string, itemId: string): SyncErrorRow {
  return {
    id,
    sync_job_id: JOB_ID,
    seller_id: 123,
    item_id: itemId,
    family_id: null,
    error_type: 'PUBLICATION_ERROR',
    error_code: null,
    error_message: 'falló',
    attempts: 0,
    status: 'OPEN',
    created_at: '2026-09-25T00:00:00.000Z',
    updated_at: '2026-09-25T00:00:00.000Z',
    resolved_at: null,
  };
}

function setup(open = [storedError('error-1', 'MLA1')]) {
  const job = {
    id: JOB_ID,
    seller_id: 123,
    full_sync_id: 'full-sync',
    started_at: '2026-09-20T00:00:00.000Z',
  };
  const jobs = {
    findById: jest.fn().mockResolvedValue(job),
    resolveRetriedItem: jest.fn().mockResolvedValue(job),
    completeAfterRetries: jest.fn().mockResolvedValue(job),
  };
  const errors = {
    findOpen: jest.fn().mockResolvedValue(open),
    findOpenByIds: jest.fn().mockResolvedValue(open),
    markRetrying: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn().mockResolvedValue(undefined),
    reopen: jest.fn().mockResolvedValue(undefined),
    countOpen: jest.fn().mockResolvedValue(0),
  };
  const tokens = {
    getStoredConnection: jest.fn().mockResolvedValue({
      user_id: 'owner',
      seller_id: 123,
    }),
    getValidAccessToken: jest.fn().mockResolvedValue('token'),
  };
  const sync = {
    syncBatch: jest.fn().mockResolvedValue({
      productsSaved: 1,
      childrenSaved: 0,
      errors: [],
    }),
    finalizeFullSync: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PublicationSyncRetryService(
    jobs as never,
    errors as never,
    tokens as never,
    sync as never,
  );
  return { errors, jobs, service, sync, tokens };
}

describe('PublicationSyncRetryService', () => {
  it('reintenta un error individual y resuelve el cleanup pendiente', async () => {
    const { errors, jobs, service, sync, tokens } = setup();

    await expect(service.retryOne('user', JOB_ID, 'error-1')).resolves.toEqual({
      syncId: JOB_ID,
      retriedItems: 1,
      resolvedItems: 1,
      openErrorsCount: 0,
    });
    expect(tokens.getValidAccessToken).toHaveBeenCalledTimes(1);
    expect(sync.syncBatch).toHaveBeenCalledWith(
      ['MLA1'],
      { sellerId: 123, accessToken: 'token' },
      'full-sync',
    );
    expect(errors.resolve).toHaveBeenCalledWith('error-1');
    expect(sync.finalizeFullSync).toHaveBeenCalledTimes(1);
    expect(jobs.resolveRetriedItem).toHaveBeenCalledWith(JOB_ID, 1);
    expect(jobs.completeAfterRetries).toHaveBeenCalledWith(JOB_ID);
  });

  it('reintenta solamente los errores seleccionados sin duplicar ids', async () => {
    const open = [
      storedError('error-1', 'MLA1'),
      storedError('error-2', 'MLA2'),
    ];
    const { errors, service, sync } = setup(open);

    await service.retrySelected('user', JOB_ID, [
      'error-1',
      'error-1',
      'error-2',
    ]);

    expect(errors.findOpenByIds).toHaveBeenCalledWith(123, [
      'error-1',
      'error-2',
    ]);
    expect(sync.syncBatch).toHaveBeenCalledTimes(2);
  });

  it('una selección vacía no obtiene token ni ejecuta cleanup', async () => {
    const { errors, service, sync, tokens } = setup([]);

    await expect(service.retrySelected('user', JOB_ID, [])).resolves.toEqual({
      syncId: JOB_ID,
      retriedItems: 0,
      resolvedItems: 0,
      openErrorsCount: 0,
    });
    expect(errors.findOpenByIds).toHaveBeenCalledWith(123, []);
    expect(tokens.getValidAccessToken).not.toHaveBeenCalled();
    expect(sync.finalizeFullSync).not.toHaveBeenCalled();
  });

  it('reintenta todos los abiertos y conserva el error si vuelve a fallar', async () => {
    const { errors, service, sync } = setup();
    sync.syncBatch.mockResolvedValue({
      productsSaved: 0,
      childrenSaved: 0,
      errors: [
        {
          itemId: 'MLA1',
          type: 'VALIDATION_ERROR',
          message: 'sigue inválido',
        },
      ],
    });
    errors.countOpen.mockResolvedValue(1);

    await expect(service.retryAll('user', JOB_ID)).resolves.toMatchObject({
      retriedItems: 1,
      resolvedItems: 0,
      openErrorsCount: 1,
    });
    expect(errors.reopen).toHaveBeenCalledWith(
      'error-1',
      'sigue inválido',
      'VALIDATION_ERROR',
    );
  });
});
