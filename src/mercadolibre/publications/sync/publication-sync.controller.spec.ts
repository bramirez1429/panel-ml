import type { SafeUser } from '../../../auth/domain/auth.models';
import { PublicationSyncController } from './publication-sync.controller';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncQueueService } from './publication-sync-queue.service';

const SYNC_ID = '11111111-1111-4111-8111-111111111111';
const USER = {
  id: '22222222-2222-4222-8222-222222222222',
} as SafeUser;

describe('PublicationSyncController', () => {
  const start = jest.fn();
  const getActive = jest.fn();
  const getStatus = jest.fn();
  const cancel = jest.fn();
  const enqueue = jest.fn();
  let controller: PublicationSyncController;

  beforeEach(() => {
    jest.resetAllMocks();
    enqueue.mockResolvedValue(undefined);
    controller = new PublicationSyncController(
      { start, getActive, getStatus, cancel } as unknown as PublicationSyncJobService,
      { enqueue } as unknown as PublicationSyncQueueService,
    );
  });

  it('inicia y encola un job pendiente', async () => {
    const response = {
      ok: true as const,
      syncId: SYNC_ID,
      status: 'PENDING' as const,
      totalItems: 42,
      processedItems: 0,
      productsSaved: 0,
      childrenSaved: 0,
      errorsCount: 0,
      lastError: null,
      hasMore: true,
    };
    start.mockResolvedValue(response);

    await expect(controller.start(USER)).resolves.toBe(response);
    expect(start).toHaveBeenCalledWith(USER.id);
    expect(enqueue).toHaveBeenCalledWith(USER.id, SYNC_ID);
  });

  it('devuelve el status actual del job con un UUID válido', async () => {
    const response = {
      ok: true as const,
      syncId: SYNC_ID,
      status: 'RUNNING' as const,
      totalItems: 42,
      processedItems: 10,
      productsSaved: 7,
      childrenSaved: 3,
      errorsCount: 1,
      lastError: null,
      hasMore: true,
    };
    getStatus.mockResolvedValue(response);

    await expect(controller.getStatus(USER, SYNC_ID)).resolves.toBe(response);
    expect(getStatus).toHaveBeenCalledWith(USER.id, SYNC_ID);
  });

  it('devuelve el trabajo activo del seller autenticado', async () => {
    const response = {
      ok: true as const,
      syncId: SYNC_ID,
      status: 'PENDING' as const,
      totalItems: 42,
      processedItems: 10,
      productsSaved: 7,
      childrenSaved: 3,
      errorsCount: 0,
      lastError: null,
      hasMore: true,
    };
    getActive.mockResolvedValue(response);

    await expect(controller.getActive(USER)).resolves.toEqual({
      activeSync: response,
    });
    expect(getActive).toHaveBeenCalledWith(USER.id);
  });

  it('devuelve null cuando el seller no tiene un trabajo activo', async () => {
    getActive.mockResolvedValue(null);

    await expect(controller.getActive(USER)).resolves.toEqual({
      activeSync: null,
    });
    expect(getActive).toHaveBeenCalledWith(USER.id);
  });

  it('cancela un job con un UUID válido', async () => {
    const response = {
      ok: true as const,
      syncId: SYNC_ID,
      status: 'CANCELLED' as const,
      totalItems: 42,
      processedItems: 10,
      productsSaved: 7,
      childrenSaved: 3,
      errorsCount: 0,
      lastError: null,
      hasMore: false,
    };
    cancel.mockResolvedValue(response);

    await expect(controller.cancel(USER, SYNC_ID)).resolves.toBe(response);
    expect(cancel).toHaveBeenCalledWith(USER.id, SYNC_ID);
  });
});
