import { Injectable } from '@nestjs/common';
import { send } from '@vercel/queue';

import { StockBulkJobService } from './stock-bulk-job.service';

export const STOCK_BULK_QUEUE_TOPIC = 'mercadolibre-stock-bulk';

export type StockBulkQueueMessage = Readonly<{
  userId: string;
  jobId: string;
}>;

@Injectable()
export class StockBulkJobQueue {
  constructor(private readonly jobService: StockBulkJobService) {}

  async enqueue(message: StockBulkQueueMessage, delaySeconds?: number) {
    if (delaySeconds === undefined) {
      await send(STOCK_BULK_QUEUE_TOPIC, message);
      return;
    }
    await send(STOCK_BULK_QUEUE_TOPIC, message, { delaySeconds });
  }

  async consume(message: StockBulkQueueMessage): Promise<void> {
    const result = await this.jobService.processNext(
      message.userId,
      message.jobId,
    );
    if (result.hasMore) {
      await this.enqueue(message, result.retryAfterSeconds ?? 1);
    }
  }
}
