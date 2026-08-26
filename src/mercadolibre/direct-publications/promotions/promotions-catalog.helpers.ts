import type { MlItem } from '../items/items.types';
import {
  normalizeTitleSearch,
  titleMatchesSearch,
} from '../publications/publication-title-search.helpers';

import type {
  PromotionCatalogAttribute,
  PromotionCatalogCandidate,
  PromotionCatalogQuery,
  PromotionCatalogStatus,
  PromotionSummary,
} from './promotions-catalog.types';
import type { MlPromotion, MlPromotions } from './promotions.types';

const CURSOR_PREFIX = 'promotions:';
const TECHNICAL_ATTRIBUTE_IDS = new Set([
  'SELLER_SKU',
  'GTIN',
  'EMPTY_GTIN_REASON',
  'MPN',
]);

export function encodePromotionsCursor(offset: number): string {
  return `${CURSOR_PREFIX}${offset}`;
}

export function decodePromotionsCursor(cursor?: string): number | null {
  if (cursor === undefined || !cursor.trim()) return 0;
  const match = /^promotions:(0|[1-9]\d*)$/u.exec(cursor);
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) ? offset : null;
}

export function toPromotionCandidate(
  item: MlItem,
): PromotionCatalogCandidate | null {
  if (
    !isText(item.id) ||
    !isText(item.title) ||
    !isText(item.category_id) ||
    !isText(item.status) ||
    typeof item.price !== 'number' ||
    !Number.isFinite(item.price)
  ) {
    return null;
  }
  return {
    itemId: item.id.trim(),
    familyId: familyIdOf(item.family_id),
    title: item.title.trim(),
    thumbnail: isText(item.thumbnail) ? item.thumbnail.trim() : null,
    categoryId: item.category_id.trim(),
    price: item.price,
    publicationStatus: item.status.trim(),
    attributes: getCommercialAttributes(item),
  };
}

export function matchesProductFilters(
  candidate: PromotionCatalogCandidate,
  query: PromotionCatalogQuery,
): boolean {
  if (
    query.search?.trim() &&
    !titleMatchesSearch(candidate.title, query.search)
  )
    return false;
  if (query.categoryId && candidate.categoryId !== query.categoryId)
    return false;
  return (query.facetFilters ?? []).every((filter) => {
    const expectedId = filter.attributeId.trim().toUpperCase();
    const expectedValue = normalizeTitleSearch(filter.value);
    return candidate.attributes.some(
      (attribute) =>
        attribute.id.toUpperCase() === expectedId &&
        normalizeTitleSearch(attribute.value) === expectedValue,
    );
  });
}

export function summarizePromotions(
  promotions: MlPromotions,
): PromotionSummary {
  const activeTypes = promotionTypes(promotions.active);
  const candidateTypes = promotionTypes(promotions.candidates);
  const pendingTypes = promotionTypes(promotions.pending);
  const status: PromotionCatalogStatus = promotions.active.length
    ? 'ACTIVE'
    : promotions.candidates.length
      ? 'AVAILABLE'
      : promotions.pending.length
        ? 'PENDING'
        : 'NONE';
  return { status, activeTypes, candidateTypes, pendingTypes };
}

export function matchesPromotionFilters(
  promotions: MlPromotions,
  summary: PromotionSummary,
  query: PromotionCatalogQuery,
): boolean {
  const status = query.promotionStatus;
  if (status && !matchesStatus(promotions, status)) return false;
  if (!query.promotionType) return true;

  const expected = query.promotionType.trim().toUpperCase();
  const types = status
    ? typesForStatus(summary, status)
    : promotionTypes(promotions.all);
  return types.some((type) => type.toUpperCase() === expected);
}

export function getCommercialAttributes(
  item: MlItem,
): PromotionCatalogAttribute[] {
  const result: PromotionCatalogAttribute[] = [];
  const seen = new Set<string>();
  appendAttributes(item.attributes, result, seen);
  for (const variation of item.variations ?? []) {
    if (!isObject(variation)) continue;
    appendAttributes(variation.attribute_combinations, result, seen);
    appendAttributes(variation.attributes, result, seen);
  }
  return result;
}

function appendAttributes(
  rawAttributes: unknown,
  result: PromotionCatalogAttribute[],
  seen: Set<string>,
): void {
  if (!Array.isArray(rawAttributes)) return;
  for (const raw of rawAttributes) {
    if (!isObject(raw) || !isText(raw.id) || !isText(raw.name)) continue;
    const id = raw.id.trim();
    if (TECHNICAL_ATTRIBUTE_IDS.has(id.toUpperCase())) continue;
    const name = raw.name.trim();
    for (const value of attributeValues(raw)) {
      const key = `${id.toUpperCase()}\u0000${normalizeTitleSearch(value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ id, name, value });
    }
  }
}

function attributeValues(attribute: Record<string, unknown>): string[] {
  const values: string[] = [];
  if (isText(attribute.value_name)) values.push(attribute.value_name.trim());
  if (Array.isArray(attribute.values)) {
    for (const entry of attribute.values) {
      if (isObject(entry) && isText(entry.name)) values.push(entry.name.trim());
    }
  }
  return [...new Set(values)];
}

function matchesStatus(
  promotions: MlPromotions,
  status: PromotionCatalogStatus,
): boolean {
  if (status === 'ACTIVE') return promotions.active.length > 0;
  if (status === 'AVAILABLE') return promotions.candidates.length > 0;
  if (status === 'PENDING') return promotions.pending.length > 0;
  return (
    promotions.active.length === 0 &&
    promotions.candidates.length === 0 &&
    promotions.pending.length === 0
  );
}

function typesForStatus(
  summary: PromotionSummary,
  status: PromotionCatalogStatus,
): readonly string[] {
  if (status === 'ACTIVE') return summary.activeTypes;
  if (status === 'AVAILABLE') return summary.candidateTypes;
  if (status === 'PENDING') return summary.pendingTypes;
  return [];
}

function promotionTypes(promotions: readonly MlPromotion[]): string[] {
  return [
    ...new Set(
      promotions.flatMap((promotion) =>
        isText(promotion.type) ? [promotion.type.trim()] : [],
      ),
    ),
  ];
}

function familyIdOf(value: string | number | null | undefined): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return String(value);
  return isText(value) ? value.trim() : null;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
