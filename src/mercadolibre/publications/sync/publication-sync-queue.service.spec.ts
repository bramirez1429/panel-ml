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

  it('publica el syncId en el topic configurado', async () => {
    await service.enqueue(SYNC_ID);

    expect(sendMock).toHaveBeenCalledWith(PUBLICATION_SYNC_QUEUE_TOPIC, {
      syncId: SYNC_ID,
    });
  });

  it('procesa un batch y publica el siguiente cuando quedan items', async () => {
    processNext.mockResolvedValue({ status: 'PENDING', hasMore: true });

    await service.consume({ syncId: SYNC_ID });

    expect(processNext).toHaveBeenCalledWith(SYNC_ID);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('termina sin publicar cuando el job está completo', async () => {
    processNext.mockResolvedValue({ status: 'COMPLETED', hasMore: false });

    await service.consume({ syncId: SYNC_ID });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('confirma una entrega duplicada que perdió el claim', async () => {
    processNext.mockRejectedValue(new ConflictException());

    await expect(service.consume({ syncId: SYNC_ID })).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('propaga otros errores para que Queues reintente', async () => {
    const error = new Error('temporal');
    processNext.mockRejectedValue(error);

    await expect(service.consume({ syncId: SYNC_ID })).rejects.toBe(error);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('aplica 10, 20 y 40 segundos con jitter al rate limit', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const error = new ServiceUnavailableException('Demasiadas solicitudes');

    expect(
      [1, 2, 3, 4].map((deliveryCount) =>
        publicationSyncQueueRetry(error, { deliveryCount }),
      ),
    ).toEqual([
      { afterSeconds: 12 },
      { afterSeconds: 22 },
      { afterSeconds: 42 },
      { afterSeconds: 42 },
    ]);

    random.mockRestore();
  });

  it('detecta 429 y deja otros errores al retry predeterminado', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);

    expect(
      publicationSyncQueueRetry(new HttpException('rate limit', 429), {
        deliveryCount: 1,
      }),
    ).toEqual({ afterSeconds: 10 });
    expect(
      publicationSyncQueueRetry(
        new ServiceUnavailableException('Servicio temporalmente caído'),
        { deliveryCount: 1 },
      ),
    ).toBeUndefined();
  });
});
