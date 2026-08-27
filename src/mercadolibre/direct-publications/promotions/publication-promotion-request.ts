import { BadRequestException } from '@nestjs/common';

import type { PromotionSwitchRequest } from './promotion-manager.types';

export function parsePromotionRequest(value: unknown): PromotionSwitchRequest {
  if (!isRecord(value) || !isText(value.type)) return invalidRequest();
  switch (value.type) {
    case 'PRICE_DISCOUNT': {
      const startDate = dateText(value.startDate, 'startDate');
      const finishDate = dateText(value.finishDate, 'finishDate');
      if (Date.parse(finishDate) < Date.parse(startDate)) {
        throw new BadRequestException(
          'finishDate debe ser posterior a startDate',
        );
      }
      return {
        type: value.type,
        dealPrice: positiveNumber(value.dealPrice, 'dealPrice'),
        ...(value.topDealPrice === undefined
          ? {}
          : {
              topDealPrice: positiveNumber(value.topDealPrice, 'topDealPrice'),
            }),
        startDate,
        finishDate,
      };
    }
    case 'DEAL':
      return {
        type: value.type,
        promotionId: requiredText(value.promotionId, 'promotionId'),
        dealPrice: positiveNumber(value.dealPrice, 'dealPrice'),
        ...(value.topDealPrice === undefined
          ? {}
          : {
              topDealPrice: positiveNumber(value.topDealPrice, 'topDealPrice'),
            }),
      };
    case 'SELLER_CAMPAIGN':
      return {
        type: value.type,
        promotionId: requiredText(value.promotionId, 'promotionId'),
        dealPrice: positiveNumber(value.dealPrice, 'dealPrice'),
      };
    case 'SMART':
      return {
        type: value.type,
        promotionId: requiredText(value.promotionId, 'promotionId'),
        offerId: requiredText(value.offerId, 'offerId'),
      };
    default:
      return invalidRequest();
  }
}

function positiveNumber(value: unknown, field: string): number {
  const parsed =
    typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} debe ser mayor a 0`);
  }
  return parsed;
}

function requiredText(value: unknown, field: string): string {
  if (!isText(value)) throw new BadRequestException(`${field} es obligatorio`);
  return value.trim();
}

function dateText(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (!Number.isFinite(Date.parse(text)))
    throw new BadRequestException(`${field} inválido`);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidRequest(): never {
  throw new BadRequestException('Solicitud de promoción inválida');
}
