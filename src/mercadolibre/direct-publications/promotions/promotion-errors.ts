import { BadRequestException } from '@nestjs/common';

export type PromotionErrorCode =
  | 'PROMOTION_NOT_FOUND'
  | 'PROMOTION_NOT_APPLICABLE'
  | 'PROMOTION_REMOVAL_FAILED'
  | 'PROMOTION_APPLICATION_FAILED'
  | 'PROMOTION_VERIFICATION_FAILED';

export function promotionError(
  code: PromotionErrorCode,
  message: string,
): BadRequestException {
  return new BadRequestException({ code, message });
}
