import { HttpException, Injectable } from '@nestjs/common';

export type StockBulkErrorDecision =
  | Readonly<{ action: 'RETRY'; delaySeconds: number; message: string }>
  | Readonly<{ action: 'ERROR'; message: string }>
  | Readonly<{ action: 'STOP'; message: string }>;

const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [5, 15, 60, 180, 300] as const;

@Injectable()
export class StockBulkErrorPolicy {
  decide(error: unknown, attemptCount: number): StockBulkErrorDecision {
    const status = httpStatus(error);
    const message = errorMessage(error);
    if (status === 401 || status === 403) return { action: 'STOP', message };
    if (status === 429 || status === 408 || status === 504 || status >= 500) {
      if (attemptCount < MAX_ATTEMPTS) {
        return {
          action: 'RETRY',
          delaySeconds:
            BACKOFF_SECONDS[
              Math.min(
                Math.max(attemptCount - 1, 0),
                BACKOFF_SECONDS.length - 1,
              )
            ],
          message,
        };
      }
    }
    return { action: 'ERROR', message };
  }
}

function httpStatus(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response.slice(0, 500);
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string') return message.slice(0, 500);
      if (Array.isArray(message)) return message.join('; ').slice(0, 500);
    }
  }
  return error instanceof Error
    ? error.message.slice(0, 500)
    : 'Error inesperado al actualizar stock';
}
