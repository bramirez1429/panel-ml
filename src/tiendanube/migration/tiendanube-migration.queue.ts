import { Injectable } from '@nestjs/common';
import { send } from '@vercel/queue';

import { TiendanubeMigrationService } from './tiendanube-migration.service';

export const TIENDANUBE_MIGRATION_QUEUE_TOPIC = 'tiendanube-global-migration';

export type TiendanubeMigrationQueueMode = 'CONTINUE' | 'SINGLE_ITEM';
export type TiendanubeMigrationQueueMessage = Readonly<{
  jobId: string;
  mode?: TiendanubeMigrationQueueMode;
}>;

@Injectable()
export class TiendanubeMigrationQueue {
  constructor(private readonly migrationService: TiendanubeMigrationService) {}

  async enqueue(
    message: TiendanubeMigrationQueueMessage,
    delaySeconds?: number,
  ): Promise<void> {
    if (delaySeconds === undefined) {
      await send(TIENDANUBE_MIGRATION_QUEUE_TOPIC, message);
      return;
    }
    await send(TIENDANUBE_MIGRATION_QUEUE_TOPIC, message, { delaySeconds });
  }

  async consume(message: TiendanubeMigrationQueueMessage): Promise<void> {
    const result = await this.migrationService.processNext(message.jobId, {
      mode: message.mode ?? 'CONTINUE',
    });
    if (result.hasMore) {
      await this.enqueue(message, result.delaySeconds ?? 1);
    }
  }
}
