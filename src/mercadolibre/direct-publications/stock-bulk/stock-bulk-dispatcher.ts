import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StockBulkJobQueue } from './stock-bulk-job.queue';
import { StockBulkLocalDispatcher } from './stock-bulk-local.dispatcher';
import type { StockBulkQueueMessage } from './stock-bulk-job.queue';

export type StockBulkDispatcherKind = 'local' | 'vercel';

export type StockBulkDispatchResult = Readonly<{
  dispatcher: StockBulkDispatcherKind;
  status: 'DISPATCHED' | 'FAILED';
  error?: string;
}>;

@Injectable()
export class StockBulkDispatcher {
  private readonly logger = new Logger(StockBulkDispatcher.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly localDispatcher: StockBulkLocalDispatcher,
    private readonly queue: StockBulkJobQueue,
  ) {}

  async dispatch(
    message: StockBulkQueueMessage,
  ): Promise<StockBulkDispatchResult> {
    const dispatcher = this.dispatcherKind();
    this.logger.log(
      `[stock-bulk] dispatcher=${dispatcher} job=${message.jobId}`,
    );
    try {
      if (dispatcher === 'vercel') {
        await this.queue.enqueue(message);
      } else {
        this.localDispatcher.start(message);
      }
      return { dispatcher, status: 'DISPATCHED' };
    } catch (error) {
      const messageText = safeMessage(error);
      this.logger.error(
        `[stock-bulk] dispatcher=${dispatcher} fallo job=${message.jobId} error=${messageText}`,
      );
      return { dispatcher, status: 'FAILED', error: messageText };
    }
  }

  private dispatcherKind(): StockBulkDispatcherKind {
    const isVercel = this.configService.get<string>('VERCEL') === '1';
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    return isVercel || isProduction ? 'vercel' : 'local';
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replaceAll(/[\r\n]+/g, ' ').slice(0, 500)
    : 'No se pudo despachar el job de stock masivo';
}
