import { send } from '@vercel/queue';

import { TiendanubeMigrationQueue } from './tiendanube-migration.queue';

jest.mock('@vercel/queue', () => ({ send: jest.fn() }));

describe('TiendanubeMigrationQueue', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reprograma un mensaje duplicado cuando el lease sigue ocupado', async () => {
    const service = {
      processNext: jest
        .fn()
        .mockResolvedValue({ hasMore: true, delaySeconds: 42 }),
    };
    const queue = new TiendanubeMigrationQueue(service as never);

    await queue.consume({
      jobId: 'job-1',
      mode: 'SINGLE_ITEM',
      executionToken: 'run-1',
    });

    expect(send).toHaveBeenCalledWith(
      'tiendanube-global-migration',
      { jobId: 'job-1', mode: 'SINGLE_ITEM', executionToken: 'run-1' },
      { delaySeconds: 42 },
    );
  });

  it('no programa un segundo producto después del modo controlado', async () => {
    const service = {
      processNext: jest
        .fn()
        .mockResolvedValue({ hasMore: false, terminal: true }),
    };
    const queue = new TiendanubeMigrationQueue(service as never);

    await queue.consume({
      jobId: 'job-1',
      mode: 'SINGLE_ITEM',
      executionToken: 'run-1',
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('preserva el token de ejecución al reprogramar', async () => {
    const service = {
      processNext: jest
        .fn()
        .mockResolvedValue({ hasMore: true, delaySeconds: 2 }),
    };
    const queue = new TiendanubeMigrationQueue(service as never);
    const message = {
      jobId: 'job-1',
      mode: 'CONTINUE' as const,
      executionToken: 'run-2',
    };

    await queue.consume(message);

    expect(service.processNext).toHaveBeenCalledWith('job-1', {
      mode: 'CONTINUE',
      executionToken: 'run-2',
    });
    expect(send).toHaveBeenCalledWith('tiendanube-global-migration', message, {
      delaySeconds: 2,
    });
  });

  it('transporta el token obligatorio en una ejecución inicial', async () => {
    const service = {
      processNext: jest.fn().mockResolvedValue({ hasMore: false }),
    };
    const queue = new TiendanubeMigrationQueue(service as never);

    await queue.consume({
      jobId: 'job-1',
      executionToken: 'run-initial',
    });

    expect(service.processNext).toHaveBeenCalledWith('job-1', {
      mode: 'CONTINUE',
      executionToken: 'run-initial',
    });
  });
});
