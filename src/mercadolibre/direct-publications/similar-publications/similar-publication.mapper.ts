import { Injectable } from '@nestjs/common';

import type { MercadoLibrePublication } from '../../publications/publication.types';
import type { MercadoLibreUserProduct } from '../../user-products/user-product.types';
import type {
  SimilarPublicationAttribute,
  SimilarPublicationDraft,
  SimilarPublicationSaleTerm,
  SimilarPublicationSourceType,
  SimilarPublicationVariant,
} from './similar-publication.types';

const IDENTIFIER_ATTRIBUTE_IDS = new Set([
  'SELLER_SKU',
  'SKU',
  'GTIN',
  'GTIN14',
  'EAN',
  'UPC',
  'ISBN',
]);
const WRITABLE_CHANNELS = new Set(['marketplace', 'mshops']);

export type SimilarPublicationMapperInput = {
  sourceKey: string;
  sourceType: SimilarPublicationSourceType;
  items: MercadoLibrePublication[];
  userProducts?: MercadoLibreUserProduct[];
  description: string | null;
};

@Injectable()
export class SimilarPublicationDraftMapper {
  map(input: SimilarPublicationMapperInput): SimilarPublicationDraft {
    const anchor = input.items[0];
    const variants =
      input.sourceType === 'USER_PRODUCT'
        ? this.mapUserProductVariants(input.items, input.userProducts ?? [])
        : this.mapLegacyVariants(anchor);

    return {
      sourceKey: input.sourceKey,
      sourceType: input.sourceType,
      categoryId: text(anchor?.category_id),
      familyName: text(anchor?.family_name),
      titleTemplate: text(anchor?.title),
      description: input.description,
      currencyId: text(anchor?.currency_id),
      listingTypeId: text(anchor?.listing_type_id),
      buyingMode: text(anchor?.buying_mode),
      saleTerms: mapSaleTerms(anchor?.sale_terms),
      shipping: isObject(anchor?.shipping)
        ? { freeShipping: anchor.shipping.free_shipping === true }
        : null,
      channels: parseChannels(anchor?.channels),
      variants,
      pictures: [],
    };
  }

  originalIdentifierValues(
    items: MercadoLibrePublication[],
    userProducts: MercadoLibreUserProduct[] = [],
  ): Set<string> {
    const values = new Set<string>();
    for (const item of items) {
      collectIdentifierValues(item.attributes, values);
      if (typeof item.seller_custom_field === 'string') {
        const value = item.seller_custom_field.trim();
        if (value) values.add(value.toLocaleLowerCase());
      }
      for (const variation of arrayObjects(item.variations)) {
        collectIdentifierValues(variation.attributes, values);
      }
    }
    for (const userProduct of userProducts) {
      collectIdentifierValues(userProduct.attributes, values);
    }
    return values;
  }

  private mapLegacyVariants(
    item: MercadoLibrePublication | undefined,
  ): SimilarPublicationVariant[] {
    if (!item) return [];
    const variations = arrayObjects(item.variations);
    if (variations.length === 0) {
      return [
        {
          sourceReference: 'variant:1',
          price: positiveNumber(item.price),
          stock: nonNegativeInteger(item.available_quantity),
          sku: null,
          attributes: mapAttributes(item.attributes),
          pictureIds: [],
        },
      ];
    }
    return variations.map((variation, index) => ({
      sourceReference: `variant:${index + 1}`,
      price: positiveNumber(variation.price) ?? positiveNumber(item.price),
      stock: nonNegativeInteger(variation.available_quantity),
      sku: null,
      attributes: mergeAttributes(
        mapAttributes(item.attributes),
        mapAttributes(variation.attribute_combinations),
        mapAttributes(variation.attributes),
      ),
      pictureIds: [],
    }));
  }

  private mapUserProductVariants(
    items: MercadoLibrePublication[],
    userProducts: MercadoLibreUserProduct[],
  ): SimilarPublicationVariant[] {
    const userProductsById = new Map(
      userProducts.map((userProduct) => [userProduct.id, userProduct]),
    );
    const offers = new Map<string, MercadoLibrePublication>();
    for (const item of items) {
      const userProductId = text(item.user_product_id);
      if (userProductId && !offers.has(userProductId)) {
        offers.set(userProductId, item);
      }
    }
    const orderedIds = [
      ...new Set([...userProducts.map(({ id }) => id), ...offers.keys()]),
    ];
    return orderedIds.flatMap((userProductId, index) => {
      const item = offers.get(userProductId);
      if (!item) return [];
      const userProduct = userProductsById.get(userProductId);
      return [
        {
          sourceReference: `variant:${index + 1}`,
          price: positiveNumber(item.price),
          stock: nonNegativeInteger(item.available_quantity),
          sku: null,
          attributes: mergeAttributes(
            mapAttributes(userProduct?.attributes),
            mapAttributes(item.attributes),
          ),
          pictureIds: [],
        },
      ];
    });
  }
}

export function isIdentifierAttribute(id: string): boolean {
  return IDENTIFIER_ATTRIBUTE_IDS.has(id.toUpperCase());
}

function mapAttributes(value: unknown): SimilarPublicationAttribute[] {
  return arrayObjects(value).flatMap((attribute) => {
    const id = text(attribute.id);
    if (!id) return [];
    const identifier = isIdentifierAttribute(id);
    return [
      {
        id,
        name: text(attribute.name),
        valueId: identifier ? null : text(attribute.value_id),
        valueName: identifier ? null : text(attribute.value_name),
        values: identifier
          ? []
          : arrayObjects(attribute.values).map((entry) => ({
              id: text(entry.id),
              name: text(entry.name),
            })),
      },
    ];
  });
}

function mergeAttributes(
  ...groups: SimilarPublicationAttribute[][]
): SimilarPublicationAttribute[] {
  const result = new Map<string, SimilarPublicationAttribute>();
  for (const attribute of groups.flat()) result.set(attribute.id, attribute);
  return [...result.values()];
}

function mapSaleTerms(value: unknown): SimilarPublicationSaleTerm[] {
  return arrayObjects(value).flatMap((term) => {
    const id = text(term.id);
    return id
      ? [
          {
            id,
            valueId: text(term.value_id),
            valueName: text(term.value_name),
          },
        ]
      : [];
  });
}

function collectIdentifierValues(value: unknown, target: Set<string>): void {
  for (const attribute of arrayObjects(value)) {
    const id = text(attribute.id);
    if (!id || !isIdentifierAttribute(id)) continue;
    for (const candidate of [attribute.value_id, attribute.value_name]) {
      const normalized = text(candidate)?.toLocaleLowerCase();
      if (normalized) target.add(normalized);
    }
    for (const entry of arrayObjects(attribute.values)) {
      const normalized = text(entry.name)?.toLocaleLowerCase();
      if (normalized) target.add(normalized);
    }
  }
}

function arrayObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      )
    : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((candidate: unknown) => {
        const channel = text(candidate);
        return channel && WRITABLE_CHANNELS.has(channel) ? [channel] : [];
      }),
    ),
  ];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
