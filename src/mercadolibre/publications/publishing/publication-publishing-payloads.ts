import { BadRequestException } from '@nestjs/common';
import { PublicationCategorySchema } from './publication-categories.service';
import {
  DraftAttribute,
  DraftVariation,
  PublicationDraft,
} from './publication-publishing.types';

export function createUserProductItem(
  draft: PublicationDraft,
  variation: DraftVariation | null,
  schema: PublicationCategorySchema,
) {
  const common = commonItem(draft, schema);
  const attributes = mergeAttributes(
    draftAttributes(draft, schema),
    variation?.attributes ?? [],
    variation?.sku ?? null,
  );
  const pictures = variation?.pictures.length
    ? variation.pictures
    : draft.pictures;
  return {
    ...common,
    family_name: draft.familyName,
    price: variation?.price ?? draft.price,
    available_quantity: variation?.stock ?? draft.stock,
    pictures: pictures.map((source) => ({ source })),
    attributes: attributes.map(attributePayload),
  };
}

export function createLegacyItem(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
) {
  if (!draft.title) {
    throw new BadRequestException(
      'title es obligatorio para una publicacion legacy',
    );
  }
  const common = commonItem(draft, schema);
  if (draft.variations.length === 0) return { ...common, title: draft.title };
  return {
    ...common,
    title: draft.title,
    pictures: legacyGallery(draft).map((source) => ({ source })),
    variations: draft.variations.map((variation) => ({
      price: draft.price,
      available_quantity: variation.stock,
      picture_ids: variation.pictures.length
        ? variation.pictures
        : draft.pictures,
      attribute_combinations: variation.attributes
        .filter((attribute) => !isVariationAttribute(attribute, schema))
        .map(attributePayload),
      ...variationAttributes(variation, schema),
    })),
  };
}

function commonItem(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
) {
  const shipping = shippingPayload(draft.shipping);
  const attributes = draftAttributes(draft, schema);
  return {
    category_id: draft.categoryId,
    price: draft.price,
    currency_id: draft.currencyId,
    available_quantity: draft.stock,
    buying_mode: 'buy_it_now',
    listing_type_id: draft.listingTypeId,
    condition: draft.condition,
    pictures: draft.pictures.map((source) => ({ source })),
    attributes: attributes.map(attributePayload),
    ...(draft.saleTerms.length
      ? { sale_terms: draft.saleTerms.map(attributePayload) }
      : {}),
    ...(shipping ? { shipping } : {}),
  };
}

function draftAttributes(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
): DraftAttribute[] {
  const attributes = [...draft.attributes];
  const itemCondition = schema.conditions.find(
    ({ id }) => id === draft.condition,
  )?.valueId;
  if (itemCondition) {
    attributes.push({ id: 'ITEM_CONDITION', valueId: itemCondition });
  }
  return attributes;
}

function variationAttributes(
  variation: DraftVariation,
  schema: PublicationCategorySchema,
) {
  const attributes = variation.attributes
    .filter((attribute) => isVariationAttribute(attribute, schema))
    .map(attributePayload);
  if (variation.sku) {
    attributes.push({ id: 'SELLER_SKU', value_name: variation.sku });
  }
  return attributes.length ? { attributes } : {};
}

function isVariationAttribute(
  attribute: DraftAttribute,
  schema: PublicationCategorySchema,
): boolean {
  return (
    schema.attributes.find(({ id }) => id === attribute.id)
      ?.variationAttribute === true
  );
}

function legacyGallery(draft: PublicationDraft): string[] {
  return [
    ...new Set([
      ...draft.pictures,
      ...draft.variations.flatMap(({ pictures }) => pictures),
    ]),
  ];
}

function mergeAttributes(
  common: DraftAttribute[],
  variant: DraftAttribute[],
  sku: string | null,
): DraftAttribute[] {
  const merged = new Map(common.map((attribute) => [attribute.id, attribute]));
  for (const attribute of variant) merged.set(attribute.id, attribute);
  if (sku) merged.set('SELLER_SKU', { id: 'SELLER_SKU', valueName: sku });
  return [...merged.values()];
}

function attributePayload(attribute: DraftAttribute) {
  return {
    id: attribute.id,
    ...(attribute.valueId ? { value_id: attribute.valueId } : {}),
    ...(attribute.valueName ? { value_name: attribute.valueName } : {}),
  };
}

function shippingPayload(shipping: PublicationDraft['shipping']) {
  if (
    shipping.mode === undefined &&
    shipping.freeShipping === undefined &&
    shipping.localPickup === undefined
  ) {
    return null;
  }
  return {
    ...(shipping.mode ? { mode: shipping.mode } : {}),
    ...(shipping.freeShipping !== undefined
      ? { free_shipping: shipping.freeShipping }
      : {}),
    ...(shipping.localPickup !== undefined
      ? { local_pick_up: shipping.localPickup }
      : {}),
  };
}
