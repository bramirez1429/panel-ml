import { HttpException } from '@nestjs/common';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RATE_LIMIT_MESSAGE = 'demasiadas solicitudes';

/** Conserva el error si falló solamente guardar la finalización. */
export class CompletionPersistenceError extends Error {
  constructor(readonly originalError: unknown) {
    super('No se pudo persistir la finalización');
  }
}

/** Indica si el error puede reintentarse sin matar el job. */
export function isRetryableSyncError(error: unknown): boolean {
  return (
    isMercadoLibreRateLimitError(error) ||
    (error instanceof HttpException &&
      RETRYABLE_STATUSES.has(error.getStatus()))
  );
}

/** Detecta el rate limit aunque Mercado Libre llegue mapeado como 503. */
export function isMercadoLibreRateLimitError(error: unknown): boolean {
  return (
    (error instanceof HttpException && error.getStatus() === 429) ||
    (error instanceof Error &&
      error.message.toLowerCase().includes(RATE_LIMIT_MESSAGE))
  );
}

/** Convierte el error en un mensaje seguro para Supabase. */
export function safeSyncErrorMessage(error: unknown): string {
  if (isMercadoLibreRateLimitError(error)) {
    return 'Mercado Libre limitó temporalmente las solicitudes';
  }
  if (!(error instanceof HttpException)) {
    return 'La sincronización no pudo continuar';
  }

  const status = error.getStatus();
  if (status === 401) {
    return 'La conexión con Mercado Libre no está autorizada';
  }
  if (status === 504) {
    return 'Mercado Libre agotó el tiempo de respuesta';
  }
  if (status >= 500) {
    return 'Un servicio externo impidió continuar';
  }
  return 'La sincronización no pudo continuar';
}

/** Describe el tipo de error sin incluir mensajes ni credenciales. */
export function safeSyncErrorLabel(error: unknown): string {
  return error instanceof HttpException
    ? `HTTP ${error.getStatus()}`
    : 'Error interno';
}
