import { PublicationSyncService } from '../publications/sync/publication-sync.service';
import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  it('repite si llega otra notificaci\u00f3n mientras el MLA est\u00e1 pendiente', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const syncItem = jest
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValue(undefined);
    const service = new WebhookService({
      syncItem,
    } as unknown as PublicationSyncService);
    const payload = {
      topic: 'items',
      resource: '/items/MLA123',
      user_id: 456,
    };

    service.receive(payload);
    service.receive(payload);
    expect(syncItem).toHaveBeenCalledTimes(1);
    expect(syncItem).toHaveBeenCalledWith('MLA123', 456);

    finish?.();
    await pending;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(syncItem).toHaveBeenCalledTimes(2);
  });

  it('ignora topics y recursos no v\u00e1lidos', () => {
    const syncItem = jest.fn();
    const service = new WebhookService({
      syncItem,
    } as unknown as PublicationSyncService);

    service.receive({ topic: 'orders', resource: '/items/MLA123', user_id: 1 });
    service.receive({
      topic: 'items',
      resource: 'https://evil.test',
      user_id: 1,
    });
    service.receive({
      topic: 'items',
      resource: '/items/MLA123',
      user_id: '1',
    });

    expect(syncItem).not.toHaveBeenCalled();
  });

  it('sincroniza items_prices para releer el precio oficial', async () => {
    const syncItem = jest.fn().mockResolvedValue(undefined);
    const service = new WebhookService({
      syncItem,
    } as unknown as PublicationSyncService);

    service.receive({
      topic: 'items_prices',
      resource: '/items/MLA123',
      user_id: 456,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(syncItem).toHaveBeenCalledWith('MLA123', 456);
  });
});
