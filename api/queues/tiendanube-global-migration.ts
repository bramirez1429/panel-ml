import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { QueueClient } from '@vercel/queue';

import { AppModule } from '../../src/app.module';
import {
  type TiendanubeMigrationQueueMessage,
  TiendanubeMigrationQueue,
} from '../../src/tiendanube/migration/tiendanube-migration.queue';

const queueClient = new QueueClient();
let applicationContext: Promise<INestApplicationContext> | undefined;

export default queueClient.handleNodeCallback(
  async (message: TiendanubeMigrationQueueMessage) => {
    const app = await getApplicationContext();
    await app.get(TiendanubeMigrationQueue).consume(message);
  },
);

function getApplicationContext(): Promise<INestApplicationContext> {
  applicationContext ??= NestFactory.createApplicationContext(AppModule);
  return applicationContext;
}
