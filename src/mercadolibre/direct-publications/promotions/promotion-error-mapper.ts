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
  if (
    typeof response !== 'object' ||
    response === null ||
    !('mercadoLibreMessage' in response)
  )
    return undefined;
  const message = response.mercadoLibreMessage;
  return typeof message === 'string' && message.trim()
    ? message.trim().slice(0, 500)
    : undefined;
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
  return new HttpException({ code, message: messageForCode(code) }, status);
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
