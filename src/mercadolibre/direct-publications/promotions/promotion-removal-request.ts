import { BadRequestException } from '@nestjs/common';

import type { PromotionRemovalSelection } from './publication-promotion.types';

export function parsePromotionRemovalSelection(
  value: unknown,
): PromotionRemovalSelection | null {
  if (!isRecord(value)) return null;
  const hasSelection =
    value.promotionType !== undefined ||
    value.promotionId !== undefined ||
    value.offerId !== undefined;
  if (!hasSelection) return null;
  const type = requiredText(value.promotionType, 'promotionType');
  const promotionId = optionalText(value.promotionId);
  const offerId = optionalText(value.offerId);
  if (type !== 'PRICE_DISCOUNT' && !promotionId) {
    throw new BadRequestException('promotionId es obligatorio');
  }
  if (type === 'SMART' && !offerId) {
    throw new BadRequestException('offerId es obligatorio para SMART');
  }
  return { type, promotionId, offerId };
}

function requiredText(value: unknown, field: string): string {
  const parsed = optionalText(value);
  if (!parsed) throw new BadRequestException(`${field} es obligatorio`);
  return parsed;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
