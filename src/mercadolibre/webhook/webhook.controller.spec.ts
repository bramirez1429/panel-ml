import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

describe('WebhookController', () => {
  it('responde inmediatamente y delega el payload', () => {
    const receive = jest.fn();
    const controller = new WebhookController({
      receive,
    } as unknown as WebhookService);
    const payload = { topic: 'items', resource: '/items/MLA123', user_id: 1 };

    expect(controller.receive(payload)).toEqual({ ok: true });
    expect(receive).toHaveBeenCalledWith(payload);
  });
});
