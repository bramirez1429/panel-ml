import { Injectable } from '@nestjs/common';
import { send } from '@vercel/queue';

import { PromotionBulkJobService } from './promotion-bulk-job.service';

export const PROMOTION_BULK_QUEUE_TOPIC = 'mercadolibre-promotion-bulk';

export type PromotionBulkQueueMessage = Readonly<{
  userId: string;
  jobId: string;
}>;

@Injectable()
export class PromotionBulkJobQueue {
  constructor(private readonly jobService: PromotionBulkJobService) {}

  async enqueue(message: PromotionBulkQueueMessage, delaySeconds?: number) {
    if (delaySeconds === undefined) {
      await send(PROMOTION_BULK_QUEUE_TOPIC, message);
      return;
    }
    await send(PROMOTION_BULK_QUEUE_TOPIC, message, { delaySeconds });
  }

  async consume(message: PromotionBulkQueueMessage): Promise<void> {
    const result = await this.jobService.processNext(
      message.userId,
      message.jobId,
    );
    if (result.hasMore) {
      await this.enqueue(message, result.retryAfterSeconds ?? 1);
    }
  }
}
