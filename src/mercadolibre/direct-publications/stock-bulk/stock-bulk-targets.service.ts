import { Injectable } from '@nestjs/common';

import type { MlAttribute, MlItem } from '../items/items.types';
import { PublicationsMapper } from '../publications/publications.mapper';
import { matchesProductType } from './stock-bulk-product-classifier';
import { normalizeStockBulkSize } from './stock-bulk-size-normalizer';
import {
  normalizeStockBulkLabel,
  type StockBulkPreviewRequest,
  type StockBulkTarget,
} from './stock-bulk.types';

type LegacyVariation = {
  id?: number | string;
  available_quantity?: number;
  attribute_combinations?: MlAttribute[];
  attributes?: MlAttribute[];
};

const EDITABLE_STATUSES = new Set(['active', 'paused']);
const SIZE_IDS = /(^|_)(SIZE|TALLE)(_|$)|FILTERABLE_SIZE/u;
const COLOR_IDS = /COLOR/u;

@Injectable()
export class StockBulkTargetsService {
  collect(
    items: readonly MlItem[],
    request: StockBulkPreviewRequest,
  ): StockBulkTarget[] {
    const quantities = new Map(
      request.sizes.map(({ size, quantity }) => [
        normalizeStockBulkSize(request.productType, size),
        { size, quantity },
      ]),
    );
    const targets: StockBulkTarget[] = [];
    for (const item of items) {
      if (!matchesProductType(item, request.productType)) {
        continue;
      }
      if (PublicationsMapper.getModel(item) === 'VARIANT_PRICING') {
        const size = attributeValue(item.attributes, SIZE_IDS);
        const requested = quantities.get(
          normalizeStockBulkSize(request.productType, size ?? ''),
        );
        if (requested) targets.push(this.userProduct(item, requested));
        continue;
      }
      const variations = legacyVariations(item.variations);
      if (variations.length === 0) {
        const size = attributeValue(item.attributes, SIZE_IDS);
        const requested = quantities.get(
          normalizeStockBulkSize(request.productType, size ?? ''),
        );
        if (requested) targets.push(this.legacy(item, null, requested));
        continue;
      }
      for (const variation of variations) {
        const attributes = [
          ...(variation.attribute_combinations ?? []),
          ...(variation.attributes ?? []),
        ];
        const size = attributeValue(attributes, SIZE_IDS);
        const requested = quantities.get(
          normalizeStockBulkSize(request.productType, size ?? ''),
        );
        if (requested) targets.push(this.legacy(item, variation, requested));
      }
    }
    return deduplicate(targets);
  }

  private userProduct(
    item: MlItem,
    request: { size: string; quantity: number },
  ): StockBulkTarget {
    const familyId = valueText(item.family_id);
    const userProductId = valueText(item.user_product_id);
    const reason = editableReason(item.status, {
      familyId,
      userProductId,
    });
    const currentQuantity = quantity(item.available_quantity);
    return {
      identifier: userProductId || item.id,
      title: item.title ?? null,
      color: attributeValue(item.attributes, COLOR_IDS),
      size: request.size,
      itemId: item.id,
      userProductId: userProductId || null,
      variationId: null,
      familyId: familyId || null,
      model: 'USER_PRODUCT',
      currentQuantity,
      requestedQuantity: request.quantity,
      currentStatus: item.status ?? null,
      needsChange: currentQuantity !== request.quantity,
      editable: reason === null,
      ...(reason ? { reason } : {}),
    };
  }

  private legacy(
    item: MlItem,
    variation: LegacyVariation | null,
    request: { size: string; quantity: number },
  ): StockBulkTarget {
    const variationId = valueText(variation?.id);
    const reason = editableReason(item.status, {
      variationId: variation && !variationId ? '' : undefined,
    });
    const attributes = variation
      ? [
          ...(variation.attribute_combinations ?? []),
          ...(variation.attributes ?? []),
        ]
      : item.attributes;
    const currentQuantity = quantity(
      variation?.available_quantity ?? item.available_quantity,
    );
    return {
      identifier: variationId ? `${item.id}:${variationId}` : item.id,
      title: item.title ?? null,
      color: attributeValue(attributes, COLOR_IDS),
      size: request.size,
      itemId: item.id,
      userProductId: null,
      variationId: variationId || null,
      familyId: null,
      model: 'LEGACY',
      currentQuantity,
      requestedQuantity: request.quantity,
      currentStatus: item.status ?? null,
      needsChange: currentQuantity !== request.quantity,
      editable: reason === null,
      ...(reason ? { reason } : {}),
    };
  }
}

function attributeValue(
  attributes: readonly MlAttribute[] | undefined,
  idPattern: RegExp,
): string | null {
  for (const attribute of attributes ?? []) {
    if (!idPattern.test(normalizeStockBulkLabel(attribute.id))) continue;
    const value = attribute.value_name ?? attribute.values?.[0]?.name;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function legacyVariations(value: unknown): LegacyVariation[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is LegacyVariation =>
          typeof entry === 'object' && entry !== null,
      )
    : [];
}

function editableReason(
  status: string | undefined,
  identifiers: Record<string, string | undefined>,
): string | null {
  if (!EDITABLE_STATUSES.has(status ?? '')) return 'STATUS_NOT_EDITABLE';
  if (Object.values(identifiers).some((value) => value === '')) {
    return 'MISSING_IDENTIFIER';
  }
  return null;
}

function valueText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

function quantity(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function deduplicate(targets: readonly StockBulkTarget[]): StockBulkTarget[] {
  const unique = new Map<string, StockBulkTarget>();
  for (const target of targets) {
    if (!unique.has(target.identifier)) unique.set(target.identifier, target);
  }
  return [...unique.values()];
}
