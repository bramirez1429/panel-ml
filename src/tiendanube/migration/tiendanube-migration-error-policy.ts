import { HttpException } from '@nestjs/common';
import { TiendanubeProductValidationError } from '../replication/mercadolibre-to-tiendanube.mapper';

const RETRY_DELAYS = [30, 60, 120, 240, 480] as const;

export type MigrationErrorDecision =
  | Readonly<{ kind: 'REJECT'; code: string; message: string }>
  | Readonly<{ kind: 'RETRY'; delaySeconds: number; message: string }>
  | Readonly<{ kind: 'PAUSE'; message: string }>;

export function decideMigrationError(
  error: unknown,
  attempts: number,
): MigrationErrorDecision {
  const message = safeMessage(error);
  if (error instanceof TiendanubeProductValidationError) {
    return {
      kind: 'REJECT',
      code: `MERCADOLIBRE_PRODUCT_${error.code}`,
      message,
    };
  }
  const status = error instanceof HttpException ? error.getStatus() : undefined;
  if (status === 401 || status === 403) return { kind: 'PAUSE', message };
  if (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429
  ) {
    return { kind: 'REJECT', code: `TIENDANUBE_${status}`, message };
  }
  if (status === 409) {
    return { kind: 'REJECT', code: 'POSSIBLE_MATCH_REVIEW', message };
  }
  if (attempts >= RETRY_DELAYS.length) return { kind: 'PAUSE', message };
  const retryAfter = retryAfterSeconds(error);
  return {
    kind: 'RETRY',
    delaySeconds: retryAfter ?? jitter(RETRY_DELAYS[Math.max(attempts - 1, 0)]),
    message,
  };
}

function retryAfterSeconds(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, 3_600)
    : undefined;
}

function jitter(delaySeconds: number): number {
  const random = Math.random();
  const boundedRandom = Number.isFinite(random) ? random : 0.5;
  return Math.max(1, Math.round(delaySeconds * (0.8 + boundedRandom * 0.4)));
}

export function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Error inesperado';
  return (
    message
      .replaceAll(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 500) || 'Error inesperado'
  );
}
