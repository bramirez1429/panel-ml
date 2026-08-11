import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { QueueClient } from '@vercel/queue';
import { AppModule } from '../../src/app.module';
import {
  PublicationSyncQueueMessage,
  PublicationSyncQueueService,
} from '../../src/mercadolibre/publications/sync/publication-sync-queue.service';

const queueClient = new QueueClient();
let applicationContext: Promise<INestApplicationContext> | undefined;

export default queueClient.handleNodeCallback(
  async (message: PublicationSyncQueueMessage) => {
    const app = await getApplicationContext();
    await app.get(PublicationSyncQueueService).consume(message);
  },
);

/** Reutiliza el contexto Nest entre invocaciones calientes. */
function getApplicationContext(): Promise<INestApplicationContext> {
  applicationContext ??= NestFactory.createApplicationContext(AppModule);
  return applicationContext;
}
