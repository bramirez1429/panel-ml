import { Injectable, Logger } from '@nestjs/common';

import { StockBulkJobService } from './stock-bulk-job.service';
import type { StockBulkQueueMessage } from './stock-bulk-job.queue';

@Injectable()
export class StockBulkLocalDispatcher {
  private readonly logger = new Logger(StockBulkLocalDispatcher.name);
  private readonly activeJobs = new Set<string>();

  constructor(private readonly jobService: StockBulkJobService) {}

  start(message: StockBulkQueueMessage): boolean {
    const key = jobKey(message);
    if (this.activeJobs.has(key)) return false;
    this.activeJobs.add(key);
    setImmediate(() => {
      this.execute(message).catch((error: unknown) => {
        this.logger.error(
          `[stock-bulk] fallo inesperado job=${message.jobId} error=${safeMessage(error)}`,
        );
      });
    });
    return true;
  }

  private async execute(message: StockBulkQueueMessage): Promise<void> {
    try {
      let hasMore = true;
      while (hasMore) {
        this.logger.log(`[stock-bulk] procesando job=${message.jobId}`);
        const result = await this.jobService.processNext(
          message.userId,
          message.jobId,
        );
        hasMore = result.hasMore;
        if (!hasMore) break;
        if (result.retryAfterSeconds !== undefined) {
          await delay(result.retryAfterSeconds * 1_000);
        } else {
          await yieldEventLoop();
        }
      }
      this.logger.log(`[stock-bulk] terminado job=${message.jobId}`);
    } catch (error) {
      this.logger.error(
        `[stock-bulk] procesamiento detenido job=${message.jobId} error=${safeMessage(error)}`,
      );
    } finally {
      this.activeJobs.delete(jobKey(message));
    }
  }
}

function jobKey(message: StockBulkQueueMessage): string {
  return `${message.userId}:${message.jobId}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function safeMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replaceAll(/[\r\n]+/g, ' ').slice(0, 500)
    : 'error desconocido';
}
