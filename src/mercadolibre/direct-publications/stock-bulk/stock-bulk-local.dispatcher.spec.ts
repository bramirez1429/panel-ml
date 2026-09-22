import type { StockBulkJobService } from './stock-bulk-job.service';
import { StockBulkLocalDispatcher } from './stock-bulk-local.dispatcher';

const MESSAGE = {
  userId: '11111111-1111-4111-8111-111111111111',
  jobId: '22222222-2222-4222-8222-222222222222',
};

describe('StockBulkLocalDispatcher', () => {
  it('usa processNext hasta terminar, un target por iteraci\u00f3n', async () => {
    const states = ['QUEUED'];
    const processNext = jest
      .fn()
      .mockImplementationOnce(() => {
        states.push('RUNNING', 'QUEUED');
        return Promise.resolve({ hasMore: true });
      })
      .mockImplementationOnce(() => {
        states.push('RUNNING', 'COMPLETED_WITH_ERRORS');
        return Promise.resolve({ hasMore: false });
      });
    const dispatcher = new StockBulkLocalDispatcher({
      processNext,
    } as unknown as StockBulkJobService);

    expect(dispatcher.start(MESSAGE)).toBe(true);
    expect(dispatcher.start(MESSAGE)).toBe(false);
    await waitForCalls(processNext, 2);

    expect(processNext).toHaveBeenNthCalledWith(
      1,
      MESSAGE.userId,
      MESSAGE.jobId,
    );
    expect(processNext).toHaveBeenNthCalledWith(
      2,
      MESSAGE.userId,
      MESSAGE.jobId,
    );
    expect(states).toEqual([
      'QUEUED',
      'RUNNING',
      'QUEUED',
      'RUNNING',
      'COMPLETED_WITH_ERRORS',
    ]);
  });

  it('maneja errores del loop sin una Promise rechazada sin control', async () => {
    const processNext = jest
      .fn()
      .mockRejectedValue(new Error('persistencia temporalmente no disponible'));
    const dispatcher = new StockBulkLocalDispatcher({
      processNext,
    } as unknown as StockBulkJobService);

    expect(dispatcher.start(MESSAGE)).toBe(true);
    await waitForCalls(processNext, 1);
    await yieldEventLoop();

    expect(processNext).toHaveBeenCalledTimes(1);
  });
});

async function waitForCalls(mock: jest.Mock, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mock.mock.calls.length >= expected) return;
    await yieldEventLoop();
  }
  throw new Error(`Se esperaban ${expected} llamadas`);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
