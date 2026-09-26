import type { SafeUser } from '../../auth/domain/auth.models';
import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';
import { PublicationSyncJobService } from './sync/publication-sync-job.service';
import { PublicationSyncDispatcherService } from './sync/publication-sync-dispatcher.service';
import { PublicationSyncRetryService } from './sync/publication-sync-retry.service';
import { PublicationSyncOverviewService } from './sync/publication-sync-overview.service';

const SYNC_ID = '11111111-1111-4111-8111-111111111111';
const APP_USER_ID = '22222222-2222-4222-8222-222222222222';
const USER = { id: APP_USER_ID } as SafeUser;

describe('PublicationsController', () => {
  const list = jest.fn();
  const findOne = jest.fn();
  const start = jest.fn();
  const processNext = jest.fn();
  const cancel = jest.fn();
  const getStatus = jest.fn();
  const enqueue = jest.fn();
  let controller: PublicationsController;

  beforeEach(() => {
    jest.resetAllMocks();
    enqueue.mockResolvedValue(undefined);
    controller = new PublicationsController(
      { list, findOne } as unknown as PublicationsService,
      {
        start,
        processNext,
        cancel,
        getStatus,
      } as unknown as PublicationSyncJobService,
      { dispatch: enqueue } as unknown as PublicationSyncDispatcherService,
      {} as PublicationSyncRetryService,
      {} as PublicationSyncOverviewService,
    );
  });

  it('aplica los valores predeterminados del listado', async () => {
    const response = { publications: [] };
    list.mockResolvedValue(response);

    await expect(controller.list(USER)).resolves.toBe(response);
    expect(list).toHaveBeenCalledWith(APP_USER_ID, 1, 20);
  });

  it('delega paginación y detalle', async () => {
    list.mockResolvedValue({});
    findOne.mockResolvedValue({});

    await controller.list(USER, '2', '50');
    await controller.findOne(USER, SYNC_ID);

    expect(list).toHaveBeenCalledWith(APP_USER_ID, 2, 50);
    expect(findOne).toHaveBeenCalledWith(APP_USER_ID, SYNC_ID);
  });

  it('inicia, encola y mantiene batch manual y estado', async () => {
    const started = {
      ok: true,
      syncId: SYNC_ID,
      status: 'PENDING',
      created: true,
    };
    const pending = { ...started, hasMore: true };
    start.mockResolvedValue(started);
    processNext.mockResolvedValue(pending);
    getStatus.mockResolvedValue(pending);

    await expect(controller.startSync(USER)).resolves.toBe(started);
    await expect(controller.processNext(USER, SYNC_ID)).resolves.toBe(pending);
    await expect(controller.getSyncStatus(USER, SYNC_ID)).resolves.toBe(
      pending,
    );

    expect(start).toHaveBeenCalledWith(APP_USER_ID);
    expect(enqueue).toHaveBeenCalledWith(APP_USER_ID, SYNC_ID);
    expect(processNext).toHaveBeenCalledWith(APP_USER_ID, SYNC_ID);
    expect(getStatus).toHaveBeenCalledWith(APP_USER_ID, SYNC_ID);
  });

  it('delega la cancelación al servicio de jobs', async () => {
    const cancelled = {
      ok: true,
      syncId: SYNC_ID,
      status: 'CANCELLED',
      hasMore: false,
    };
    cancel.mockResolvedValue(cancelled);

    await expect(controller.cancelSync(USER, SYNC_ID)).resolves.toBe(cancelled);
    expect(cancel).toHaveBeenCalledWith(APP_USER_ID, SYNC_ID);
  });
});
