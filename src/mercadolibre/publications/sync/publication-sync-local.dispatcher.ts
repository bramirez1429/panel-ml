import { Injectable, Logger } from '@nestjs/common';
import { isRetryableSyncError } from './publication-sync-job-error.helpers';
import { PublicationSyncJobService } from './publication-sync-job.service';

export type LocalPublicationSyncMessage = Readonly<{
  userId: string;
  syncId: string;
}>;

@Injectable()
export class PublicationSyncLocalDispatcher {
  private readonly logger = new Logger(PublicationSyncLocalDispatcher.name);
  private readonly activeJobs = new Set<string>();

  constructor(private readonly jobs: PublicationSyncJobService) {}

  start(message: LocalPublicationSyncMessage): boolean {
    const key = jobKey(message);
    if (this.activeJobs.has(key)) return false;
    this.activeJobs.add(key);
    setImmediate(() => {
      this.execute(message).catch((error: unknown) => {
        this.logger.error(
          `[publication-sync] fallo inesperado sync=${message.syncId} error=${safeMessage(error)}`,
        );
      });
    });
    return true;
  }

  private async execute(message: LocalPublicationSyncMessage): Promise<void> {
    let retryAttempt = 0;
    try {
      while (true) {
        try {
          const result = await this.jobs.processNext(
            message.userId,
            message.syncId,
          );
          retryAttempt = 0;
          if (!result.hasMore) break;
          await yieldEventLoop();
        } catch (error) {
          if (!isRetryableSyncError(error)) throw error;
          retryAttempt += 1;
          await delay(retryDelayMilliseconds(retryAttempt));
        }
      }
      this.logger.log(`[publication-sync] terminado sync=${message.syncId}`);
    } catch (error) {
      this.logger.error(
        `[publication-sync] procesamiento detenido sync=${message.syncId} error=${safeMessage(error)}`,
      );
    } finally {
      this.activeJobs.delete(jobKey(message));
    }
  }
}

function jobKey(message: LocalPublicationSyncMessage): string {
  return `${message.userId}:${message.syncId}`;
}

function retryDelayMilliseconds(attempt: number): number {
  return Math.min(2 ** Math.max(attempt - 1, 0) * 1_000, 30_000);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function safeMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replaceAll(/[\r\n]+/g, ' ').slice(0, 300)
    : 'error desconocido';
}
