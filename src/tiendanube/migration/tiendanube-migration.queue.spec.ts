import { send } from '@vercel/queue';

import { TiendanubeMigrationQueue } from './tiendanube-migration.queue';

jest.mock('@vercel/queue', () => ({ send: jest.fn() }));

describe('TiendanubeMigrationQueue', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reprograma un mensaje duplicado cuando el lease sigue ocupado', async () => {
    const service = {
      processNext: jest.fn().mockResolvedValue({ hasMore: true, delaySeconds: 42 }),
    };
    const queue = new TiendanubeMigrationQueue(service as never);

    await queue.consume({ jobId: 'job-1', mode: 'SINGLE_ITEM' });

    expect(send).toHaveBeenCalledWith(
      'tiendanube-global-migration',
      { jobId: 'job-1', mode: 'SINGLE_ITEM' },
      { delaySeconds: 42 },
    );
  });

  it('no programa un segundo producto después del modo controlado', async () => {
    const service = {
      processNext: jest.fn().mockResolvedValue({ hasMore: false, terminal: true }),
    };
    const queue = new TiendanubeMigrationQueue(service as never);

    await queue.consume({ jobId: 'job-1', mode: 'SINGLE_ITEM' });

    expect(send).not.toHaveBeenCalled();
  });
});
