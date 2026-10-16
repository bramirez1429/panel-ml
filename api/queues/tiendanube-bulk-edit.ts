import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { QueueClient } from '@vercel/queue';
import { AppModule } from '../../src/app.module';
import { TiendanubeBulkEditQueue, type TiendanubeBulkEditQueueMessage } from '../../src/tiendanube/bulk-edit/tiendanube-bulk-edit.queue';
const client = new QueueClient(); let context: Promise<INestApplicationContext> | undefined;
export default client.handleNodeCallback(async (message: TiendanubeBulkEditQueueMessage) => (await (context ??= NestFactory.createApplicationContext(AppModule))).get(TiendanubeBulkEditQueue).consume(message));
