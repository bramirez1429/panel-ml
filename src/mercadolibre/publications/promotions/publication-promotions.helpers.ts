import { BadGatewayException, BadRequestException } from '@nestjs/common';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';

export type NormalizedPromotion = Readonly<{
  promotionId: string | null;
  offerId: string | null;
  type: string;
  status: string | null;
  price: number | null;
  originalPrice: number | null;
  promotionPercentage: number | null;
  startDate: string | null;
  endDate: string | null;
  name: string | null;
  minDiscountedPrice: number | null;
  maxDiscountedPrice: number | null;
  suggestedDiscountedPrice: number | null;
  topDealPrice: number | null;
  boostedOffer: boolean;
}>;

export function normalizePromotions(value: unknown): NormalizedPromotion[] {
  const entries = Array.isArray(value)
    ? value
    : isJsonObject(value) && Array.isArray(value.results)
      ? value.results
      : null;
  if (!entries) invalidPromotions();
  return entries.map((candidate) => {
    if (!isJsonObject(candidate) || !isNonEmptyString(candidate.type)) {
      invalidPromotions();
    }
    const price = amount(candidate.price);
    const originalPrice = amount(candidate.original_price);
    return {
      promotionId: text(candidate.id),
      offerId: text(candidate.ref_id) ?? text(candidate.offer_id),
      type: candidate.type.trim(),
      status: text(candidate.status),
      price,
      originalPrice,
      promotionPercentage: percentage(originalPrice, price),
      startDate: text(candidate.start_date),
      endDate: text(candidate.finish_date) ?? text(candidate.end_date),
      name: text(candidate.name),
      minDiscountedPrice: amount(candidate.min_discounted_price),
      maxDiscountedPrice: amount(candidate.max_discounted_price),
      suggestedDiscountedPrice: amount(candidate.suggested_discounted_price),
      topDealPrice: amount(candidate.top_deal_price),
      boostedOffer: candidate.boosted_offer === true,
    };
  });
}

export function currentPromotion(promotions: NormalizedPromotion[]) {
  const rank = new Map([
    ['started', 0],
    ['pending', 1],
    ['sync_requested', 2],
    ['candidate', 3],
    ['finished', 4],
  ]);
  return (
    [...promotions].sort(
      (left, right) =>
        (rank.get(left.status ?? '') ?? 9) -
        (rank.get(right.status ?? '') ?? 9),
    )[0] ?? null
  );
}

export function parsePriceDiscountInput(body: unknown) {
  if (!isJsonObject(body)) throw new BadRequestException('Body invalido');
  if (
    typeof body.dealPrice !== 'number' ||
    !Number.isFinite(body.dealPrice) ||
    body.dealPrice <= 0
  ) {
    throw new BadRequestException('dealPrice debe ser mayor que cero');
  }
  const startDate = date(body.startDate, 'startDate');
  const finishDate = date(body.finishDate, 'finishDate');
  if (Date.parse(finishDate) <= Date.parse(startDate)) {
    throw new BadRequestException('finishDate debe ser posterior a startDate');
  }
  const startDay = utcDay(startDate);
  const finishDay = utcDay(finishDate);
  const calendarDays = Math.floor((finishDay - startDay) / 86_400_000) + 1;
  if (calendarDays < 1 || calendarDays > 14) {
    throw new BadRequestException('PRICE_DISCOUNT admite entre 1 y 14 dias');
  }
  const topDealPrice = optionalPositive(body.topDealPrice, 'topDealPrice');
  return {
    dealPrice: body.dealPrice,
    topDealPrice,
    startDate,
    finishDate,
    itemId: body.itemId,
    variationId: body.variationId,
    userProductId: body.userProductId,
  };
}

export function parsePromotionSelector(body: unknown, queryItemId?: unknown) {
  const object = body === undefined ? {} : body;
  if (!isJsonObject(object)) throw new BadRequestException('Body invalido');
  if (
    object.itemId !== undefined &&
    queryItemId !== undefined &&
    object.itemId !== queryItemId
  ) {
    throw new BadRequestException('itemId no coincide entre query y body');
  }
  return {
    itemId: object.itemId ?? queryItemId,
    variationId: object.variationId,
    userProductId: object.userProductId,
  };
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function percentage(
  regular: number | null,
  sale: number | null,
): number | null {
  if (!regular || sale === null || sale >= regular) return null;
  return Math.round(((regular - sale) / regular) * 10_000) / 100;
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function date(value: unknown, field: string): string {
  if (
    !isNonEmptyString(value) ||
    !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value.trim())
  ) {
    throw new BadRequestException(`${field} debe ser una fecha ISO valida`);
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new BadRequestException(`${field} debe ser una fecha ISO valida`);
  }
  return value.trim();
}

function utcDay(value: string): number {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function optionalPositive(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BadRequestException(`${field} debe ser mayor que cero`);
  }
  return value;
}

function invalidPromotions(): never {
  throw new BadGatewayException('Mercado Libre devolvio promociones invalidas');
}
