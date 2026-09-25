import { ConfigService } from '@nestjs/config';
import { PublicationSyncDispatcherService } from './publication-sync-dispatcher.service';

function setup(values: Record<string, string | undefined>) {
  const local = { start: jest.fn().mockReturnValue(true) };
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) => values[key]),
  };
  const service = new PublicationSyncDispatcherService(
    config as unknown as ConfigService,
    local as never,
    queue as never,
  );
  return { local, queue, service };
}

describe('PublicationSyncDispatcherService', () => {
  it('usa local por default en desarrollo', async () => {
    const { local, queue, service } = setup({ NODE_ENV: 'development' });

    await service.dispatch('user-1', 'sync-1');

    expect(local.start).toHaveBeenCalledWith({
      userId: 'user-1',
      syncId: 'sync-1',
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('usa queue por default en producción o cuando se configura', async () => {
    const production = setup({ NODE_ENV: 'production' });
    await production.service.dispatch('user-1', 'sync-1');
    expect(production.queue.enqueue).toHaveBeenCalledWith('user-1', 'sync-1');

    const configured = setup({
      NODE_ENV: 'development',
      PUBLICATION_SYNC_DRIVER: 'queue',
    });
    await configured.service.dispatch('user-2', 'sync-2');
    expect(configured.queue.enqueue).toHaveBeenCalledWith('user-2', 'sync-2');
  });

  it('rechaza un driver inválido', () => {
    const { service } = setup({ PUBLICATION_SYNC_DRIVER: 'otro' });
    expect(() => service.driver()).toThrow('PUBLICATION_SYNC_DRIVER');
  });
});
