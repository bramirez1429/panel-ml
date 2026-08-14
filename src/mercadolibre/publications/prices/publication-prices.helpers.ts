import { BadGatewayException } from '@nestjs/common';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';

export type NormalizedPrice = Readonly<{
  id: string | null;
  type: string;
  amount: number;
  regularAmount: number | null;
  currencyId: string | null;
  lastUpdated: string | null;
  contextRestrictions: string[];
  startDate: string | null;
  endDate: string | null;
  promotionId: string | null;
  promotionType: string | null;
  quantityRestricted: boolean;
}>;

export function normalizePricesResponse(
  value: unknown,
  expectedItemId: string,
): NormalizedPrice[] {
  if (!isJsonObject(value)) invalidPrices();
  if (value.id !== undefined && value.id !== expectedItemId) invalidPrices();
  if (!Array.isArray(value.prices)) invalidPrices();
  return value.prices.map(normalizePrice);
}

export function normalizeSalePrice(value: unknown) {
  if (!isJsonObject(value)) invalidPrices();
  const amount = optionalAmount(value.amount);
  if (amount === null) invalidPrices();
  const metadata = isJsonObject(value.metadata) ? value.metadata : {};
  return {
    amount,
    regularAmount: optionalAmount(value.regular_amount),
    currencyId: text(value.currency_id),
    promotionId: text(metadata.promotion_id),
    promotionType: text(metadata.promotion_type),
  };
}

export function selectPrice(
  prices: NormalizedPrice[],
  type: 'standard' | 'promotion',
): NormalizedPrice | null {
  const candidates = prices.filter(
    (price) =>
      !price.quantityRestricted &&
      (price.type === type ||
        (type === 'promotion' && price.type !== 'standard')),
  );
  return (
    candidates.find(({ contextRestrictions }) =>
      exactContext(contextRestrictions, 'channel_marketplace'),
    ) ??
    candidates.find(
      ({ contextRestrictions }) => contextRestrictions.length === 0,
    ) ??
    candidates.find(({ contextRestrictions }) =>
      exactContext(contextRestrictions, 'channel_marketplace_seller'),
    ) ?? null
  );
}

export function discountPercentage(
  regularPrice: number | null,
  salePrice: number | null,
): number | null {
  if (!regularPrice || salePrice === null || salePrice >= regularPrice) {
    return null;
  }
  return Math.round(((regularPrice - salePrice) / regularPrice) * 10_000) / 100;
}

function normalizePrice(value: unknown): NormalizedPrice {
  if (!isJsonObject(value) || !isNonEmptyString(value.type)) invalidPrices();
  const amount = optionalAmount(value.amount);
  if (amount === null) invalidPrices();
  const conditions = isJsonObject(value.conditions) ? value.conditions : {};
  const contexts = conditions.context_restrictions;
  if (
    contexts !== undefined &&
    (!Array.isArray(contexts) ||
      contexts.some((item) => typeof item !== 'string'))
  ) {
    invalidPrices();
  }
  const contextRestrictions: string[] = [];
  if (Array.isArray(contexts)) {
    const candidates: unknown[] = contexts;
    for (const context of candidates) {
      if (typeof context === 'string') contextRestrictions.push(context);
    }
  }
  const metadata = isJsonObject(value.metadata) ? value.metadata : {};
  return {
    id: text(value.id),
    type: value.type.trim().toLowerCase(),
    amount,
    regularAmount: optionalAmount(value.regular_amount),
    currencyId: text(value.currency_id),
    lastUpdated: text(value.last_updated),
    contextRestrictions,
    startDate: text(conditions.start_time) ?? text(conditions.start_date),
    endDate: text(conditions.end_time) ?? text(conditions.end_date),
    promotionId: text(metadata.promotion_id),
    promotionType: text(metadata.promotion_type),
    quantityRestricted:
      positiveInteger(conditions.min_purchase_unit) !== null ||
      positiveInteger(conditions.max_purchase_unit) !== null,
  };
}

function exactContext(contexts: readonly string[], expected: string): boolean {
  return contexts.length === 1 && contexts[0] === expected;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function optionalAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function invalidPrices(): never {
  throw new BadGatewayException('Mercado Libre devolvio precios invalidos');
}
