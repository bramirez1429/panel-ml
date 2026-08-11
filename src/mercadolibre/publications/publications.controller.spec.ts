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

  it('autentica y reprograma un error temporal interno', async () => {
    const temporaryError = new Error('falla temporal');
    const pending = {
      ok: true,
      syncId: SYNC_ID,
      status: 'PENDING',
      processedItems: 10,
      productsSaved: 5,
      childrenSaved: 5,
      errorsCount: 0,
      lastError: 'Error temporal',
      hasMore: true,
    };
    processNext.mockRejectedValue(temporaryError);
    getStatus.mockResolvedValue(pending);

    expect(controller.processInternalNext(SYNC_ID, 'internal-secret')).toEqual({
      ok: true,
      syncId: SYNC_ID,
      status: 'ACCEPTED',
    });
    await defer.mock.calls[0][1];

    expect(assertInternalSecret).toHaveBeenCalledWith('internal-secret');
    expect(dispatchNext).toHaveBeenCalledWith(SYNC_ID);
  });

  it('no reprograma un job interno fallido', async () => {
    const fatalError = new Error('falla fatal');
    processNext.mockRejectedValue(fatalError);
    getStatus.mockResolvedValue({ status: 'FAILED' });

    controller.processInternalNext(SYNC_ID, 'internal-secret');
    await expect(defer.mock.calls[0][1]).rejects.toBe(fatalError);

    expect(dispatchNext).not.toHaveBeenCalled();
  });

  it('encadena otro request interno cuando quedan publicaciones', async () => {
    processNext.mockResolvedValue({ status: 'PENDING', hasMore: true });

    controller.processInternalNext(SYNC_ID, 'internal-secret');
    await defer.mock.calls[0][1];

    expect(dispatchNext).toHaveBeenCalledWith(SYNC_ID);
  });

  it('no despacha otra invocación cuando el job completó', async () => {
    processNext.mockResolvedValue({ status: 'COMPLETED', hasMore: false });

    controller.processInternalNext(SYNC_ID, 'internal-secret');
    await defer.mock.calls[0][1];

    expect(dispatchNext).not.toHaveBeenCalled();
  });
});
