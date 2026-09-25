import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicationSyncLocalDispatcher } from './publication-sync-local.dispatcher';
import { PublicationSyncQueueService } from './publication-sync-queue.service';

export type PublicationSyncDriver = 'queue' | 'local';

@Injectable()
export class PublicationSyncDispatcherService {
  private readonly logger = new Logger(PublicationSyncDispatcherService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly local: PublicationSyncLocalDispatcher,
    private readonly queue: PublicationSyncQueueService,
  ) {}

  async dispatch(userId: string, syncId: string): Promise<void> {
    const driver = this.driver();
    this.logger.log(`[publication-sync] driver=${driver} sync=${syncId}`);
    if (driver === 'queue') {
      await this.queue.enqueue(userId, syncId);
      return;
    }
    this.local.start({ userId, syncId });
  }

  driver(): PublicationSyncDriver {
    const configured = this.config
      .get<string>('PUBLICATION_SYNC_DRIVER')
      ?.trim()
      .toLowerCase();
    if (configured === 'queue' || configured === 'local') return configured;
    if (configured) {
      throw new Error('PUBLICATION_SYNC_DRIVER debe ser queue o local');
    }
    return this.config.get<string>('NODE_ENV') === 'production'
      ? 'queue'
      : 'local';
  }
}
