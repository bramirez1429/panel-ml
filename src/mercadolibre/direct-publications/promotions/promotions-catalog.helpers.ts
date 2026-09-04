import type { MlItem } from '../items/items.types';
import { titleMatchesSearch } from '../publications/publication-title-search.helpers';

import type {
  PromotionCatalogCandidate,
  PromotionCatalogQuery,
  PromotionCatalogStatus,
  PromotionSummary,
  NormalizedPromotion,
} from './promotions-catalog.types';
import type { MlPromotion, MlPromotions } from './promotions.types';
import { classifyPromotionProductGroup } from './promotions-product-group';
import {
  financingCampaignTagOf,
  promotionCampaignItemCommerceOf,
} from './promotion-campaign-item-commerce';

const CURSOR_PREFIX = 'promotions:';

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
  const productGroup = classifyPromotionProductGroup(item);
  if (
    !productGroup ||
    !isText(item.id) ||
    !isText(item.title) ||
    !isText(item.category_id) ||
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
    ...promotionCampaignItemCommerceOf(item),
    productGroup,
    price: item.price,
    categoryId: item.category_id.trim(),
    currencyId: isText(item.currency_id) ? item.currency_id.trim() : null,
    domainId: isText(item.domain_id) ? item.domain_id.trim() : null,
    catalogProductId: isText(item.catalog_product_id)
      ? item.catalog_product_id.trim()
      : null,
    listingTypeId: isText(item.listing_type_id)
      ? item.listing_type_id.trim()
      : null,
    shippingMode: isText(item.shipping?.mode)
      ? item.shipping.mode.trim()
      : null,
    logisticType: isText(item.shipping?.logistic_type)
      ? item.shipping.logistic_type.trim()
      : null,
    condition: isText(item.condition) ? item.condition.trim() : null,
    billableWeight: finiteNumber(item.billable_weight),
    campaignTag: financingCampaignTagOf(item),
  };
}

export function matchesProductFilters(
  candidate: PromotionCatalogCandidate,
  query: PromotionCatalogQuery,
): boolean {
  if (query.productGroup && candidate.productGroup !== query.productGroup)
    return false;
  return (
    !query.search?.trim() || titleMatchesSearch(candidate.title, query.search)
  );
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

export function normalizePromotion(
  promotion: MlPromotion,
): NormalizedPromotion {
  const originalPrice = finiteNumber(promotion.original_price);
  const promotionPrice = finiteNumber(promotion.price);
  const discountPercent =
    originalPrice !== null &&
    promotionPrice !== null &&
    originalPrice > 0 &&
    promotionPrice > 0 &&
    promotionPrice < originalPrice
      ? Math.round(((originalPrice - promotionPrice) / originalPrice) * 10000) /
        100
      : null;
  return {
    id: textOrNull(promotion.id),
    offerId: textOrNull(promotion.ref_id ?? promotion.offer_id),
    type: textOrNull(promotion.type),
    name: textOrNull(promotion.name),
    originalPrice,
    promotionPrice,
    discountPercent,
    startDate: textOrNull(promotion.start_date),
    finishDate: textOrNull(promotion.finish_date),
  };
}

export function currentPromotion(
  promotions: MlPromotions,
): NormalizedPromotion | null {
  const active = promotions.active[0];
  return active ? normalizePromotion(active) : null;
}

export function availablePromotions(
  promotions: MlPromotions,
): NormalizedPromotion[] {
  return promotions.candidates.map(normalizePromotion);
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

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return isText(value) ? value.trim() : null;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
