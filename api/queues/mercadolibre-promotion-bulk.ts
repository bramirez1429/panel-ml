import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { QueueClient } from '@vercel/queue';

import { AppModule } from '../../src/app.module';
import {
  type PromotionBulkQueueMessage,
  PromotionBulkJobQueue,
} from '../../src/mercadolibre/direct-publications/promotions/promotion-bulk-job.queue';

const queueClient = new QueueClient();
let applicationContext: Promise<INestApplicationContext> | undefined;

export default queueClient.handleNodeCallback(
  async (message: PromotionBulkQueueMessage) => {
    const app = await getApplicationContext();
    await app.get(PromotionBulkJobQueue).consume(message);
  },
);

function getApplicationContext(): Promise<INestApplicationContext> {
  applicationContext ??= NestFactory.createApplicationContext(AppModule);
  return applicationContext;
}
