import type { ConfigService } from '@nestjs/config';

import { StockBulkDispatcher } from './stock-bulk-dispatcher';
import type { StockBulkJobQueue } from './stock-bulk-job.queue';
import type { StockBulkLocalDispatcher } from './stock-bulk-local.dispatcher';

const MESSAGE = {
  userId: '11111111-1111-4111-8111-111111111111',
  jobId: '22222222-2222-4222-8222-222222222222',
};

describe('StockBulkDispatcher', () => {
  it('usa el dispatcher local fuera de Vercel y no llama a la queue', async () => {
    const dependencies = setup({ NODE_ENV: 'development' });

    await expect(dependencies.dispatcher.dispatch(MESSAGE)).resolves.toEqual({
      dispatcher: 'local',
      status: 'DISPATCHED',
    });

    expect(dependencies.local.start).toHaveBeenCalledWith(MESSAGE);
    expect(dependencies.queue.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    [{ NODE_ENV: 'production' }],
    [{ NODE_ENV: 'development', VERCEL: '1' }],
  ])('usa Vercel Queue cuando el entorno lo indica', async (environment) => {
    const dependencies = setup(environment);

    await expect(dependencies.dispatcher.dispatch(MESSAGE)).resolves.toEqual({
      dispatcher: 'vercel',
      status: 'DISPATCHED',
    });

    expect(dependencies.queue.enqueue).toHaveBeenCalledWith(MESSAGE);
    expect(dependencies.local.start).not.toHaveBeenCalled();
  });

  it('devuelve el fallo seguro conservando el job persistido', async () => {
    const dependencies = setup({ NODE_ENV: 'production' });
    dependencies.queue.enqueue.mockRejectedValue(
      new Error('OIDC ausente\nno se pudo enviar'),
    );

    await expect(dependencies.dispatcher.dispatch(MESSAGE)).resolves.toEqual({
      dispatcher: 'vercel',
      status: 'FAILED',
      error: 'OIDC ausente no se pudo enviar',
    });
  });
});

function setup(environment: Record<string, string>) {
  const config = {
    get: jest.fn((key: string) => environment[key]),
  };
  const local = { start: jest.fn().mockReturnValue(true) };
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
  return {
    dispatcher: new StockBulkDispatcher(
      config as unknown as ConfigService,
      local as unknown as StockBulkLocalDispatcher,
      queue as unknown as StockBulkJobQueue,
    ),
    local,
    queue,
  };
}
