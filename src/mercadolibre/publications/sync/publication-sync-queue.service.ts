import { ConflictException, Injectable } from '@nestjs/common';
import { send } from '@vercel/queue';
import { PublicationSyncJobService } from './publication-sync-job.service';

export const PUBLICATION_SYNC_QUEUE_TOPIC = 'mercadolibre-publication-sync';

export interface PublicationSyncQueueMessage {
  syncId: string;
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
