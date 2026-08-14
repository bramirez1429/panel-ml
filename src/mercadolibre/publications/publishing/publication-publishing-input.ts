import { BadRequestException } from '@nestjs/common';
import {
  DraftAttribute,
  DraftVariation,
  PublicationDraft,
} from './publication-publishing.types';
import {
  assertKeys,
  identifier,
  list,
  optionalBoolean,
  optionalText,
  positiveNumber,
  quantity,
  record,
  text,
} from './publication-publishing-input.helpers';

const TOP_LEVEL = new Set([
  'categoryId',
  'category_id',
  'title',
  'familyName',
  'family_name',
  'currencyId',
  'currency_id',
  'price',
  'stock',
  'availableQuantity',
  'available_quantity',
  'listingTypeId',
  'listing_type_id',
  'condition',
  'description',
  'attributes',
  'saleTerms',
  'sale_terms',
  'variations',
  'variants',
  'pictures',
  'shipping',
]);
const VARIATION = new Set([
  'sku',
  'price',
  'stock',
  'availableQuantity',
  'available_quantity',
  'attributes',
  'pictures',
]);
const ATTRIBUTE = new Set([
  'id',
  'valueId',
  'value_id',
  'valueName',
  'value_name',
]);
const SHIPPING = new Set([
  'mode',
  'freeShipping',
  'free_shipping',
  'localPickup',
  'local_pick_up',
]);

export function parsePublicationDraft(value: unknown): PublicationDraft {
  const input = record(value, 'El body de la publicacion es invalido');
  assertKeys(input, TOP_LEVEL, 'publicacion');
  const shipping = parseShipping(input.shipping);
  const variations = list(
    input.variations ?? input.variants,
    'variations',
    250,
  ).map(parseVariation);

  return {
    categoryId: identifier(
      input.categoryId ?? input.category_id,
      'categoryId',
      /^MLA\d+$/,
    ),
    title: optionalText(input.title, 'title', 200),
    familyName: optionalText(
      input.familyName ?? input.family_name,
      'familyName',
      200,
    ),
    currencyId: identifier(
      input.currencyId ?? input.currency_id,
      'currencyId',
      /^[A-Z]{3}$/,
    ),
    price: positiveNumber(input.price, 'price'),
    stock: quantity(
      input.stock ?? input.availableQuantity ?? input.available_quantity,
      'stock',
    ),
    listingTypeId: identifier(
      input.listingTypeId ?? input.listing_type_id,
      'listingTypeId',
      /^[a-z0-9_]{2,40}$/,
    ),
    condition: identifier(
      input.condition,
      'condition',
      /^(new|used|refurbished|not_specified)$/,
    ),
    description: optionalText(input.description, 'description', 50_000),
    attributes: parseAttributes(input.attributes, 'attributes'),
    saleTerms: parseAttributes(
      input.saleTerms ?? input.sale_terms,
      'saleTerms',
    ),
    variations,
    pictures: parsePictures(input.pictures, 'pictures'),
    shipping,
  };
}

function parseVariation(value: unknown, index: number): DraftVariation {
  const input = record(value, `variations[${index}] es invalida`);
  assertKeys(input, VARIATION, `variations[${index}]`);
  return {
    sku: optionalText(input.sku, `variations[${index}].sku`, 64),
    price: positiveNumber(input.price, `variations[${index}].price`),
    stock: quantity(
      input.stock ?? input.availableQuantity ?? input.available_quantity,
      `variations[${index}].stock`,
    ),
    attributes: parseAttributes(
      input.attributes,
      `variations[${index}].attributes`,
    ),
    pictures: parsePictures(input.pictures, `variations[${index}].pictures`),
  };
}

function parseAttributes(value: unknown, field: string): DraftAttribute[] {
  const seen = new Set<string>();
  return list(value, field, 200).map((candidate, index) => {
    const input = record(candidate, `${field}[${index}] es invalido`);
    assertKeys(input, ATTRIBUTE, `${field}[${index}]`);
    const id = identifier(
      input.id,
      `${field}[${index}].id`,
      /^[A-Z0-9_-]{1,100}$/,
    );
    if (seen.has(id)) {
      throw new BadRequestException(`${field} contiene IDs duplicados`);
    }
    seen.add(id);
    const valueId = optionalText(
      input.valueId ?? input.value_id,
      `${field}[${index}].valueId`,
      255,
    );
    const valueName = optionalText(
      input.valueName ?? input.value_name,
      `${field}[${index}].valueName`,
      255,
    );
    if (!valueId && !valueName) {
      throw new BadRequestException(
        `${field}[${index}] requiere valueId o valueName`,
      );
    }
    return {
      id,
      ...(valueId ? { valueId } : {}),
      ...(valueName ? { valueName } : {}),
    };
  });
}

function parsePictures(value: unknown, field: string): string[] {
  const pictures = list(value, field, 50).map((candidate, index) => {
    const source = text(candidate, `${field}[${index}]`, 2_000);
    try {
      const url = new URL(source);
      if (url.protocol !== 'https:') throw new Error();
      return url.toString();
    } catch {
      throw new BadRequestException(
        `${field}[${index}] debe ser una URL https`,
      );
    }
  });
  if (new Set(pictures).size !== pictures.length) {
    throw new BadRequestException(`${field} no admite duplicados`);
  }
  return pictures;
}

function parseShipping(value: unknown): PublicationDraft['shipping'] {
  if (value === undefined || value === null) return {};
  const input = record(value, 'shipping debe ser un objeto');
  assertKeys(input, SHIPPING, 'shipping');
  const mode = optionalText(input.mode, 'shipping.mode', 40);
  const freeShipping = optionalBoolean(
    input.freeShipping ?? input.free_shipping,
    'shipping.freeShipping',
  );
  const localPickup = optionalBoolean(
    input.localPickup ?? input.local_pick_up,
    'shipping.localPickup',
  );
  return {
    ...(mode ? { mode } : {}),
    ...(freeShipping !== null ? { freeShipping } : {}),
    ...(localPickup !== null ? { localPickup } : {}),
  };
}
