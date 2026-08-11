import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';
import { PublicationSyncDispatcherService } from './sync/publication-sync-dispatcher.service';
import { PublicationSyncJobService } from './sync/publication-sync-job.service';

const SYNC_ID = '11111111-1111-4111-8111-111111111111';

describe('PublicationsController', () => {
  const list = jest.fn();
  const findOne = jest.fn();
  const start = jest.fn();
  const processNext = jest.fn();
  const getStatus = jest.fn();
  const dispatchNext = jest.fn();
  const defer = jest.fn<void, [string, Promise<unknown>]>();
  const assertInternalSecret = jest.fn();
  let controller: PublicationsController;

  beforeEach(() => {
    jest.resetAllMocks();
    dispatchNext.mockResolvedValue(undefined);
    controller = new PublicationsController(
      { list, findOne } as unknown as PublicationsService,
      { start, processNext, getStatus } as unknown as PublicationSyncJobService,
      {
        dispatchNext,
        defer,
        assertInternalSecret,
      } as unknown as PublicationSyncDispatcherService,
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

  it('delega inicio, siguiente batch y estado del sync job', async () => {
    const started = { ok: true, syncId: SYNC_ID, status: 'PENDING' };
    const pending = { ...started, hasMore: true };
    start.mockResolvedValue(started);
    processNext.mockResolvedValue(pending);
    getStatus.mockResolvedValue(pending);

    await expect(controller.startSync()).resolves.toBe(started);
    await expect(controller.processNext(SYNC_ID)).resolves.toBe(pending);
    await expect(controller.getSyncStatus(SYNC_ID)).resolves.toBe(pending);

    expect(start).toHaveBeenCalledTimes(1);
    expect(processNext).toHaveBeenCalledWith(SYNC_ID);
    expect(getStatus).toHaveBeenCalledWith(SYNC_ID);
    expect(dispatchNext).toHaveBeenCalledTimes(1);
    expect(dispatchNext).toHaveBeenCalledWith(SYNC_ID);
    expect(defer).toHaveBeenCalledWith(SYNC_ID, expect.any(Promise));
  });

  it('procesa y encadena otro request interno cuando quedan publicaciones', async () => {
    const pending = {
      ok: true,
      syncId: SYNC_ID,
      status: 'PENDING',
      processedItems: 10,
      productsSaved: 5,
      childrenSaved: 5,
      errorsCount: 0,
      hasMore: true,
    };
    processNext.mockResolvedValue(pending);

    await expect(
      controller.processInternalNext(SYNC_ID, 'internal-secret'),
    ).resolves.toBe(pending);

    expect(assertInternalSecret).toHaveBeenCalledWith('internal-secret');
    expect(processNext).toHaveBeenCalledWith(SYNC_ID);
    expect(dispatchNext).toHaveBeenCalledWith(SYNC_ID);
    expect(defer).toHaveBeenCalledWith(SYNC_ID, expect.any(Promise));
  });

  it('propaga el error del batch interno al dispatcher HTTP', async () => {
    const error = new Error('falla temporal');
    processNext.mockRejectedValue(error);

    await expect(
      controller.processInternalNext(SYNC_ID, 'internal-secret'),
    ).rejects.toBe(error);

    expect(defer).not.toHaveBeenCalled();
    expect(dispatchNext).not.toHaveBeenCalled();
  });

  it('no despacha otra invocación cuando el job completó', async () => {
    const completed = { status: 'COMPLETED', hasMore: false };
    processNext.mockResolvedValue(completed);

    await expect(
      controller.processInternalNext(SYNC_ID, 'internal-secret'),
    ).resolves.toBe(completed);

    expect(defer).not.toHaveBeenCalled();
    expect(dispatchNext).not.toHaveBeenCalled();
  });
});
