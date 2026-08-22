import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { send } from '@vercel/queue';
import { PublicationSyncJobService } from './publication-sync-job.service';
import {
  PUBLICATION_SYNC_QUEUE_TOPIC,
  PublicationSyncQueueService,
  publicationSyncQueueRetry,
} from './publication-sync-queue.service';

jest.mock('@vercel/queue', () => ({ send: jest.fn() }));

const SYNC_ID = '11111111-1111-4111-8111-111111111111';
const APP_USER_ID = '22222222-2222-4222-8222-222222222222';
const sendMock = jest.mocked(send);

describe('PublicationSyncQueueService', () => {
  const processNext = jest.fn();
  let service: PublicationSyncQueueService;

  beforeEach(() => {
    jest.resetAllMocks();
    sendMock.mockResolvedValue({ messageId: 'message-id' });
    service = new PublicationSyncQueueService({
      processNext,
    } as unknown as PublicationSyncJobService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('publica userId y syncId en el topic configurado', async () => {
    await service.enqueue(APP_USER_ID, SYNC_ID);

    expect(sendMock).toHaveBeenCalledWith(PUBLICATION_SYNC_QUEUE_TOPIC, {
      userId: APP_USER_ID,
      syncId: SYNC_ID,
    });
  });

  it('procesa un batch y publica el siguiente cuando quedan items', async () => {
    processNext.mockResolvedValue({ status: 'PENDING', hasMore: true });

    await service.consume({ userId: APP_USER_ID, syncId: SYNC_ID });

    expect(processNext).toHaveBeenCalledWith(APP_USER_ID, SYNC_ID);
    expect(sendMock).toHaveBeenCalledWith(
      PUBLICATION_SYNC_QUEUE_TOPIC,
      { userId: APP_USER_ID, syncId: SYNC_ID },
      { delaySeconds: 15 },
    );
  });

  it('termina sin publicar cuando el job está completo', async () => {
    processNext.mockResolvedValue({ status: 'COMPLETED', hasMore: false });

    await service.consume({ userId: APP_USER_ID, syncId: SYNC_ID });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('confirma una entrega duplicada que perdió el claim', async () => {
    processNext.mockRejectedValue(new ConflictException());

    await expect(
      service.consume({ userId: APP_USER_ID, syncId: SYNC_ID }),
    ).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('propaga otros errores para que Queues reintente', async () => {
    const error = new Error('temporal');
    processNext.mockRejectedValue(error);

    await expect(
      service.consume({ userId: APP_USER_ID, syncId: SYNC_ID }),
    ).rejects.toBe(error);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('aplica 60, 120 y 240 segundos al rate limit', () => {
    const error = new ServiceUnavailableException('Demasiadas solicitudes');

    expect(
      [1, 2, 3, 4].map((deliveryCount) =>
        publicationSyncQueueRetry(error, { deliveryCount }),
      ),
    ).toEqual([
      { afterSeconds: 60 },
      { afterSeconds: 120 },
      { afterSeconds: 240 },
      { afterSeconds: 240 },
    ]);
  });

  it('detecta 429 y deja otros errores al retry predeterminado', () => {
    expect(
      publicationSyncQueueRetry(new HttpException('rate limit', 429), {
        deliveryCount: 1,
      }),
    ).toEqual({ afterSeconds: 60 });
    expect(
      publicationSyncQueueRetry(
        new ServiceUnavailableException('Servicio temporalmente caído'),
        { deliveryCount: 1 },
      ),
    ).toBeUndefined();
  });
});
