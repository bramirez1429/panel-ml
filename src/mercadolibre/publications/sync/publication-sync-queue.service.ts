import { ConflictException, Injectable } from '@nestjs/common';
import { send, type MessageMetadata, type RetryDirective } from '@vercel/queue';
import { isMercadoLibreRateLimitError } from './publication-sync-job-error.helpers';
import { PublicationSyncJobService } from './publication-sync-job.service';

export const PUBLICATION_SYNC_QUEUE_TOPIC = 'mercadolibre-publication-sync';
const RATE_LIMIT_BACKOFF_SECONDS = [10, 20, 40] as const;
const RATE_LIMIT_JITTER_SECONDS = 3;

export interface PublicationSyncQueueMessage {
  syncId: string;
}

/** Reprograma rate limits sin dormir dentro de la Function. */
export function publicationSyncQueueRetry(
  error: unknown,
  metadata: Pick<MessageMetadata, 'deliveryCount'>,
): RetryDirective | undefined {
  if (!isMercadoLibreRateLimitError(error)) return undefined;

  const index = Math.min(
    Math.max(metadata.deliveryCount - 1, 0),
    RATE_LIMIT_BACKOFF_SECONDS.length - 1,
  );
  const jitter = Math.floor(Math.random() * RATE_LIMIT_JITTER_SECONDS);

  return { afterSeconds: RATE_LIMIT_BACKOFF_SECONDS[index] + jitter };
}

@Injectable()
export class PublicationSyncQueueService {
  /** Recibe la lógica existente del job. */
  constructor(private readonly syncJobService: PublicationSyncJobService) {}

  /** Publica una invocación durable del siguiente batch. */
  async enqueue(syncId: string): Promise<void> {
    const message: PublicationSyncQueueMessage = { syncId };
    await send(PUBLICATION_SYNC_QUEUE_TOPIC, message);
  }

  /** Procesa un mensaje y publica el siguiente cuando corresponde. */
  async consume(message: PublicationSyncQueueMessage): Promise<void> {
    try {
      const result = await this.syncJobService.processNext(message.syncId);

      if (result.hasMore) {
        await this.enqueue(message.syncId);
      }
    } catch (error) {
      if (error instanceof ConflictException) return;
      throw error;
    }
  }
}
