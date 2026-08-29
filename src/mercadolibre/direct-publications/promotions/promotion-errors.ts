import { HttpException, HttpStatus } from '@nestjs/common';

export type PromotionErrorCode =
  | 'PROMOTION_NOT_FOUND'
  | 'PROMOTION_NOT_APPLICABLE'
  | 'PROMOTION_NOT_AVAILABLE_FOR_ALL_ITEMS'
  | 'PROMOTION_CHANGED_DURING_OPERATION'
  | 'PROMOTION_REMOVAL_FAILED'
  | 'PROMOTION_APPLICATION_FAILED'
  | 'PROMOTION_VERIFICATION_FAILED'
  | 'PROMOTION_PARTIAL_FAILURE'
  | 'PROMOTION_TIMEOUT'
  | 'PROMOTION_PERMISSION_DENIED'
  | 'PROMOTION_RATE_LIMITED'
  | 'PROMOTION_PROVIDER_UNAVAILABLE';

export type PromotionErrorDetails = Readonly<Record<string, unknown>>;

export function promotionError(
  code: PromotionErrorCode,
  message: string,
  details?: PromotionErrorDetails,
  status = HttpStatus.BAD_REQUEST,
): HttpException {
  return new HttpException({ code, message, ...details }, status);
}

export function promotionErrorCode(error: unknown): PromotionErrorCode | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  if (
    typeof response !== 'object' ||
    response === null ||
    !('code' in response)
  )
    return null;
  const code = response.code;
  return typeof code === 'string' && isPromotionErrorCode(code) ? code : null;
}

export function isPromotionException(error: unknown): boolean {
  return promotionErrorCode(error) !== null;
}

export function isPromotionErrorCode(
  value: unknown,
): value is PromotionErrorCode {
  if (typeof value !== 'string') return false;
  return PROMOTION_ERROR_CODES.has(value as PromotionErrorCode);
}

const PROMOTION_ERROR_CODES = new Set<PromotionErrorCode>([
  'PROMOTION_NOT_FOUND',
  'PROMOTION_NOT_APPLICABLE',
  'PROMOTION_NOT_AVAILABLE_FOR_ALL_ITEMS',
  'PROMOTION_CHANGED_DURING_OPERATION',
  'PROMOTION_REMOVAL_FAILED',
  'PROMOTION_APPLICATION_FAILED',
  'PROMOTION_VERIFICATION_FAILED',
  'PROMOTION_PARTIAL_FAILURE',
  'PROMOTION_TIMEOUT',
  'PROMOTION_PERMISSION_DENIED',
  'PROMOTION_RATE_LIMITED',
  'PROMOTION_PROVIDER_UNAVAILABLE',
]);
