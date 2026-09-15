import { PublicationSyncService } from '../publications/sync/publication-sync.service';
import { MercadolibreSaleIngestionService } from '../../sales/mercadolibre-sale-ingestion.service';
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
    const service = new WebhookService(
      {
        syncItem,
      } as unknown as PublicationSyncService,
      {
        receive: jest.fn(),
      } as unknown as MercadolibreSaleIngestionService,
    );
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
    const receive = jest.fn();
    const service = new WebhookService(
      {
        syncItem,
      } as unknown as PublicationSyncService,
      {
        receive,
      } as unknown as MercadolibreSaleIngestionService,
    );

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
    expect(receive).not.toHaveBeenCalled();
  });

  it('delega orders_v2 al registro de ventas', () => {
    const receive = jest.fn();
    const service = new WebhookService(
      { syncItem: jest.fn() } as unknown as PublicationSyncService,
      { receive } as unknown as MercadolibreSaleIngestionService,
    );

    service.receive({
      topic: 'orders_v2',
      resource: '/orders/2000001234567890',
      user_id: 456,
    });

    expect(receive).toHaveBeenCalledWith('2000001234567890', 456);
  });
});
