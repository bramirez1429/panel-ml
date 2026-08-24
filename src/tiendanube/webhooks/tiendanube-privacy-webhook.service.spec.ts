import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import type { TiendanubeEnvironment } from '../shared/tiendanube.config';
import { TiendanubePrivacyWebhookService } from './tiendanube-privacy-webhook.service';
import type { TiendanubeIncomingWebhook } from './tiendanube-privacy-webhook.types';

const CLIENT_SECRET = 'private-client-secret';

type ConnectionRepositoryMock = jest.Mocked<
  Pick<TiendanubeConnectionRepository, 'deleteByStoreId'>
>;

describe('TiendanubePrivacyWebhookService', () => {
  let service: TiendanubePrivacyWebhookService;
  let connectionRepository: ConnectionRepositoryMock;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: keyof TiendanubeEnvironment) =>
        key === 'TIENDANUBE_CLIENT_SECRET' ? CLIENT_SECRET : undefined,
      ),
    } as unknown as ConfigService<TiendanubeEnvironment>;
    connectionRepository = {
      deleteByStoreId: jest.fn().mockResolvedValue(undefined),
    };
    service = new TiendanubePrivacyWebhookService(
      configService,
      connectionRepository as unknown as TiendanubeConnectionRepository,
    );
  });

  it('valida la firma y elimina exclusivamente por el storeId normalizado', async () => {
    const webhook = createSignedWebhook({ store_id: 987654 });

    await expect(service.handleStoreRedact(webhook)).resolves.toBeUndefined();

    expect(connectionRepository.deleteByStoreId).toHaveBeenCalledTimes(1);
    expect(connectionRepository.deleteByStoreId).toHaveBeenCalledWith('987654');
  });

  it('acepta los webhooks de clientes sin ejecutar borrados inexistentes', () => {
    const webhook = createSignedWebhook({
      store_id: '987654',
      customer: { id: 123456 },
    });

    expect(() => service.handleCustomersRedact(webhook)).not.toThrow();
    expect(() => service.handleCustomersDataRequest(webhook)).not.toThrow();
    expect(connectionRepository.deleteByStoreId).not.toHaveBeenCalled();
  });

  it('rechaza con 400 un payload minimo invalido sin tocar el repositorio', async () => {
    const webhook = createSignedWebhook({ store_id: 0 });

    await expect(service.handleStoreRedact(webhook)).rejects.toMatchObject({
      status: 400,
    });
    expect(connectionRepository.deleteByStoreId).not.toHaveBeenCalled();
  });

  it('rechaza una firma invalida sin exponer secretos', async () => {
    const webhook = {
      ...createSignedWebhook({ store_id: 987654 }),
      signature: '0'.repeat(64),
    };

    let caught: unknown;
    try {
      await service.handleStoreRedact(webhook);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ status: 401 });
    expect(JSON.stringify(caught)).not.toContain(CLIENT_SECRET);
    expect(connectionRepository.deleteByStoreId).not.toHaveBeenCalled();
  });
});

function createSignedWebhook(payload: unknown): TiendanubeIncomingWebhook {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    rawBody,
    signature: createHmac('sha256', CLIENT_SECRET)
      .update(rawBody)
      .digest('hex'),
    payload,
  };
}
