import { HttpException } from '@nestjs/common';
import type { SyncErrorType } from '../../../database/database.types';

export type ClassifiedSyncError = Readonly<{
  type: SyncErrorType;
  code: string | null;
  message: string;
  httpStatus: number | null;
}>;

export function classifySyncError(error: unknown): ClassifiedSyncError {
  const status = error instanceof HttpException ? error.getStatus() : null;
  const response = error instanceof HttpException ? error.getResponse() : null;
  const code = extractCode(response);
  const message = safeMessage(error, response);

  if (status === 401 || status === 403) {
    return { type: 'AUTH_ERROR', code, message, httpStatus: status };
  }
  if (status === 429) {
    return { type: 'RATE_LIMIT', code, message, httpStatus: status };
  }
  if (status !== null && status >= 500) {
    return {
      type: looksLikeSchemaError(message)
        ? 'POSSIBLE_API_CHANGE'
        : 'PROVIDER_TEMPORARY_ERROR',
      code,
      message,
      httpStatus: status,
    };
  }
  if (code && !KNOWN_CODES.has(code)) {
    return {
      type: 'POSSIBLE_API_CHANGE',
      code,
      message,
      httpStatus: status,
    };
  }
  if (status === 400 || status === 422) {
    return { type: 'VALIDATION_ERROR', code, message, httpStatus: status };
  }
  if (looksLikeSchemaError(message)) {
    return {
      type: 'POSSIBLE_API_CHANGE',
      code,
      message,
      httpStatus: status,
    };
  }
  return { type: 'PUBLICATION_ERROR', code, message, httpStatus: status };
}

export function classifyProviderResponse(
  status: number,
  body: unknown,
): ClassifiedSyncError {
  return classifySyncError(new HttpException(body ?? 'Error externo', status));
}

const KNOWN_CODES = new Set([
  'not_found',
  'validation_error',
  'invalid_parameter',
  'forbidden',
  'unauthorized',
  'too_many_requests',
]);

function extractCode(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const code = object.error ?? object.code ?? object.error_code;
  return typeof code === 'string' && code.trim()
    ? code.trim().slice(0, 100)
    : null;
}

function safeMessage(error: unknown, response: unknown): string {
  const responseMessage = extractMessage(response);
  if (responseMessage) return responseMessage;
  if (error instanceof Error && error.message.trim()) {
    return sanitize(error.message);
  }
  return 'No se pudo procesar la publicación';
}

function extractMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return sanitize(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = (value as Record<string, unknown>).message;
  return typeof message === 'string' && message.trim()
    ? sanitize(message)
    : null;
}

function sanitize(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [REDACTED]')
    .replace(/(access_token|refresh_token)=([^\s&]+)/giu, '$1=[REDACTED]')
    .slice(0, 500);
}

function looksLikeSchemaError(message: string): boolean {
  return /(schema|estructura|respuesta.*inv[aá]lida|campo.*obligatorio|unexpected)/iu.test(
    message,
  );
}
