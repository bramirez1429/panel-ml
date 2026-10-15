import { HttpException } from '@nestjs/common';

const RETRY_DELAYS = [30, 90, 300] as const;

export type MigrationErrorDecision =
  | Readonly<{ kind: 'REJECT'; code: string; message: string }>
  | Readonly<{ kind: 'RETRY'; delaySeconds: number; message: string }>
  | Readonly<{ kind: 'PAUSE'; message: string }>;

export function decideMigrationError(
  error: unknown,
  attempts: number,
): MigrationErrorDecision {
  const message = safeMessage(error);
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
  return {
    kind: 'RETRY',
    delaySeconds: RETRY_DELAYS[Math.max(attempts - 1, 0)],
    message,
  };
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
