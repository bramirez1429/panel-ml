import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { QueueClient } from '@vercel/queue';

import { AppModule } from '../../src/app.module';
import {
  type StockBulkQueueMessage,
  StockBulkJobQueue,
} from '../../src/mercadolibre/direct-publications/stock-bulk/stock-bulk-job.queue';

const queueClient = new QueueClient();
let applicationContext: Promise<INestApplicationContext> | undefined;

export default queueClient.handleNodeCallback(
  async (message: StockBulkQueueMessage) => {
    const app = await getApplicationContext();
    await app.get(StockBulkJobQueue).consume(message);
  },
);

function getApplicationContext(): Promise<INestApplicationContext> {
  applicationContext ??= NestFactory.createApplicationContext(AppModule);
  return applicationContext;
}
