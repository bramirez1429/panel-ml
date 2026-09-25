import { ConflictException, Injectable } from '@nestjs/common';
import { send, type MessageMetadata, type RetryDirective } from '@vercel/queue';
import { isMercadoLibreRateLimitError } from './publication-sync-job-error.helpers';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncService } from './publication-sync.service';

export const PUBLICATION_SYNC_QUEUE_TOPIC = 'mercadolibre-publication-sync';
const NEXT_BATCH_DELAY_SECONDS = 15;
const RATE_LIMIT_BACKOFF_SECONDS = [60, 120, 240] as const;

export interface FullPublicationSyncQueueMessage {
  kind?: 'FULL_SYNC';
  userId: string;
  syncId: string;
}

export interface PublicationMirrorRepairMessage {
  kind: 'REPAIR_ITEM';
  sellerId: number;
  itemId: string;
}

export type PublicationSyncQueueMessage =
  FullPublicationSyncQueueMessage | PublicationMirrorRepairMessage;

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
  return { afterSeconds: RATE_LIMIT_BACKOFF_SECONDS[index] };
}

@Injectable()
export class PublicationSyncQueueService {
  /** Recibe la lógica existente del job. */
  constructor(
    private readonly syncJobService: PublicationSyncJobService,
    private readonly syncService: PublicationSyncService,
  ) {}

  /** Publica una invocación durable del siguiente batch. */
  async enqueue(
    userId: string,
    syncId: string,
    delaySeconds?: number,
  ): Promise<void> {
    const message: FullPublicationSyncQueueMessage = { userId, syncId };
    if (delaySeconds === undefined) {
      await send(PUBLICATION_SYNC_QUEUE_TOPIC, message);
      return;
    }
    await send(PUBLICATION_SYNC_QUEUE_TOPIC, message, { delaySeconds });
  }

  async enqueueRepair(sellerId: number, itemId: string): Promise<void> {
    await send(PUBLICATION_SYNC_QUEUE_TOPIC, {
      kind: 'REPAIR_ITEM',
      sellerId,
      itemId,
    } satisfies PublicationMirrorRepairMessage);
  }

  /** Procesa un mensaje y publica el siguiente cuando corresponde. */
  async consume(message: PublicationSyncQueueMessage): Promise<void> {
    if (message.kind === 'REPAIR_ITEM') {
      await this.syncService.syncItem(message.itemId, message.sellerId);
      return;
    }
    try {
      const result = await this.syncJobService.processNext(
        message.userId,
        message.syncId,
      );

      if (result.hasMore) {
        await this.enqueue(
          message.userId,
          message.syncId,
          NEXT_BATCH_DELAY_SECONDS,
        );
      }
    } catch (error) {
      if (error instanceof ConflictException) return;
      throw error;
    }
  }
}
