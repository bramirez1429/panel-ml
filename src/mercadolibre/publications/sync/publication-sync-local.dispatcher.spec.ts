import type { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncLocalDispatcher } from './publication-sync-local.dispatcher';

const MESSAGE = { userId: 'user-1', syncId: 'sync-1' };

describe('PublicationSyncLocalDispatcher', () => {
  it('procesa batches con processNext hasta terminar', async () => {
    const processNext = jest
      .fn()
      .mockResolvedValueOnce({ hasMore: true })
      .mockResolvedValueOnce({ hasMore: true })
      .mockResolvedValueOnce({ hasMore: false });
    const dispatcher = new PublicationSyncLocalDispatcher({
      processNext,
    } as unknown as PublicationSyncJobService);

    expect(dispatcher.start(MESSAGE)).toBe(true);
    await waitForCalls(processNext, 3);

    expect(processNext).toHaveBeenCalledTimes(3);
    expect(processNext).toHaveBeenCalledWith('user-1', 'sync-1');
  });

  it('no inicia dos workers para el mismo job', async () => {
    let finish: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const processNext = jest.fn().mockImplementation(async () => {
      await blocked;
      return { hasMore: false };
    });
    const dispatcher = new PublicationSyncLocalDispatcher({
      processNext,
    } as unknown as PublicationSyncJobService);

    expect(dispatcher.start(MESSAGE)).toBe(true);
    expect(dispatcher.start(MESSAGE)).toBe(false);
    finish?.();
    await waitForCalls(processNext, 1);
  });

  it('detiene el worker local cuando processNext informa CANCELLED', async () => {
    const processNext = jest
      .fn()
      .mockResolvedValueOnce({ status: 'PENDING', hasMore: true })
      .mockResolvedValueOnce({ status: 'CANCELLED', hasMore: false });
    const dispatcher = new PublicationSyncLocalDispatcher({
      processNext,
    } as unknown as PublicationSyncJobService);

    expect(dispatcher.start(MESSAGE)).toBe(true);
    await waitForCalls(processNext, 2);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(processNext).toHaveBeenCalledTimes(2);
  });
});

async function waitForCalls(mock: jest.Mock, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (mock.mock.calls.length >= expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Se esperaban ${expected} llamadas`);
}
