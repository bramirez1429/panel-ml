import { HttpException, HttpStatus } from '@nestjs/common';

import {
  promotionErrorCode,
  type PromotionErrorCode,
} from './promotion-errors';

export function normalizePromotionError(
  error: unknown,
  fallback: PromotionErrorCode,
  businessCode: PromotionErrorCode = 'PROMOTION_CHANGED_DURING_OPERATION',
): PromotionErrorCode {
  const existing = promotionErrorCode(error);
  if (existing) return existing;
  if (!(error instanceof HttpException)) return fallback;
  const status = error.getStatus();
  if (status === 401 || status === 403) return 'PROMOTION_PERMISSION_DENIED';
  if (status === 404) return 'PROMOTION_NOT_FOUND';
  if (status === 400 || status === 409) return businessCode;
  if (status === 429) return 'PROMOTION_RATE_LIMITED';
  if (status === 504) return 'PROMOTION_TIMEOUT';
  if (status >= 500) return 'PROMOTION_PROVIDER_UNAVAILABLE';
  return fallback;
}

export function isTimeout(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 504;
}

export function promotionProviderMessage(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (typeof response === 'string') return safeProviderText(response);
  if (typeof response !== 'object' || response === null) return undefined;
  const body = response as Record<string, unknown>;
  return (
    safeProviderText(body.mercadoLibreMessage) ??
    safeProviderText(body.message) ??
    providerCauseMessage(body.cause)
  );
}

export function promotionProviderStatus(error: unknown): number | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (typeof response === 'object' && response !== null) {
    const body = response as Record<string, unknown>;
    const original = body.mercadoLibreStatus ?? body.status;
    if (
      typeof original === 'number' &&
      Number.isInteger(original) &&
      original >= 100 &&
      original <= 599
    ) {
      return original;
    }
  }
  return error.getStatus();
}

export function normalizedPromotionException(
  error: unknown,
  fallback: PromotionErrorCode,
): HttpException {
  const code = normalizePromotionError(error, fallback);
  const sourceStatus =
    error instanceof HttpException ? error.getStatus() : null;
  const status =
    code === 'PROMOTION_PERMISSION_DENIED' && sourceStatus === 401
      ? HttpStatus.UNAUTHORIZED
      : statusForCode(code);
  const providerMessage = promotionProviderMessage(error);
  const providerStatus = promotionProviderStatus(error);
  return new HttpException(
    {
      code,
      message: messageForCode(code),
      ...(providerMessage ? { providerMessage } : {}),
      ...(providerStatus ? { providerStatus } : {}),
    },
    status,
  );
}

function providerCauseMessage(value: unknown): string | undefined {
  const causes = Array.isArray(value) ? value : [value];
  for (const cause of causes) {
    if (typeof cause !== 'object' || cause === null) continue;
    const detail = cause as Record<string, unknown>;
    const message =
      safeProviderText(detail.message) ??
      safeProviderText(detail.error_message);
    if (message) return message;
  }
  return undefined;
}

function safeProviderText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : undefined;
}

function statusForCode(code: PromotionErrorCode): number {
  if (code === 'PROMOTION_NOT_FOUND') return HttpStatus.NOT_FOUND;
  if (code === 'PROMOTION_PERMISSION_DENIED') return HttpStatus.FORBIDDEN;
  if (code === 'PROMOTION_RATE_LIMITED') return 429;
  if (code === 'PROMOTION_TIMEOUT') return HttpStatus.GATEWAY_TIMEOUT;
  if (code === 'PROMOTION_PROVIDER_UNAVAILABLE')
    return HttpStatus.SERVICE_UNAVAILABLE;
  if (
    code === 'PROMOTION_NOT_APPLICABLE' ||
    code === 'PROMOTION_NOT_AVAILABLE_FOR_ALL_ITEMS' ||
    code === 'PROMOTION_CHANGED_DURING_OPERATION'
  )
    return HttpStatus.CONFLICT;
  return HttpStatus.BAD_GATEWAY;
}

function messageForCode(code: PromotionErrorCode): string {
  const messages: Record<PromotionErrorCode, string> = {
    PROMOTION_NOT_FOUND: 'La promoción o publicación ya no existe',
    PROMOTION_NOT_APPLICABLE: 'La promoción ya no es aplicable',
    PROMOTION_NOT_AVAILABLE_FOR_ALL_ITEMS:
      'La promoción no está disponible para toda la publicación',
    PROMOTION_CHANGED_DURING_OPERATION:
      'La promoción cambió durante la operación',
    PROMOTION_REMOVAL_FAILED: 'No se pudo quitar la promoción',
    PROMOTION_APPLICATION_FAILED: 'No se pudo aplicar la promoción',
    PROMOTION_VERIFICATION_FAILED:
      'No se pudo verificar el estado final de la promoción',
    PROMOTION_PARTIAL_FAILURE: 'La operación tuvo errores parciales',
    PROMOTION_TIMEOUT: 'Mercado Libre agotó el tiempo de respuesta',
    PROMOTION_PERMISSION_DENIED: 'La conexión no tiene autorización suficiente',
    PROMOTION_RATE_LIMITED: 'Mercado Libre limitó las solicitudes',
    PROMOTION_PROVIDER_UNAVAILABLE:
      'Mercado Libre no está disponible temporalmente',
  };
  return messages[code];
}
