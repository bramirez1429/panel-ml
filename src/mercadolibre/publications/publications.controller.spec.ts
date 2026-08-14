import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';
import { PublicationSyncJobService } from './sync/publication-sync-job.service';
import { PublicationSyncQueueService } from './sync/publication-sync-queue.service';

const SYNC_ID = '11111111-1111-4111-8111-111111111111';

describe('PublicationsController', () => {
  const list = jest.fn();
  const findOne = jest.fn();
  const start = jest.fn();
  const processNext = jest.fn();
  const getStatus = jest.fn();
  const enqueue = jest.fn();
  let controller: PublicationsController;

  beforeEach(() => {
    jest.resetAllMocks();
    enqueue.mockResolvedValue(undefined);
    controller = new PublicationsController(
      { list, findOne } as unknown as PublicationsService,
      { start, processNext, getStatus } as unknown as PublicationSyncJobService,
      { enqueue } as unknown as PublicationSyncQueueService,
    );
  });

  it('aplica los valores predeterminados del listado', async () => {
    const response = { publications: [] };
    list.mockResolvedValue(response);

    await expect(controller.list()).resolves.toBe(response);
    expect(list).toHaveBeenCalledWith(1, 20);
  });

  it('delega paginación y detalle', async () => {
    list.mockResolvedValue({});
    findOne.mockResolvedValue({});

    await controller.list('2', '50');
    await controller.findOne(SYNC_ID);

    expect(list).toHaveBeenCalledWith(2, 50);
    expect(findOne).toHaveBeenCalledWith(SYNC_ID);
  });

  it('inicia, encola y mantiene batch manual y estado', async () => {
    const started = { ok: true, syncId: SYNC_ID, status: 'PENDING' };
    const pending = { ...started, hasMore: true };
    start.mockResolvedValue(started);
    processNext.mockResolvedValue(pending);
    getStatus.mockResolvedValue(pending);

    await expect(controller.startSync()).resolves.toBe(started);
    await expect(controller.processNext(SYNC_ID)).resolves.toBe(pending);
    await expect(controller.getSyncStatus(SYNC_ID)).resolves.toBe(pending);

    expect(start).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(SYNC_ID);
    expect(processNext).toHaveBeenCalledWith(SYNC_ID);
    expect(getStatus).toHaveBeenCalledWith(SYNC_ID);
  });
});
