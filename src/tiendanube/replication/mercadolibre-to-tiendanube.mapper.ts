import { BadGatewayException } from '@nestjs/common';

import type {
  ReplicableProduct,
  ReplicableProductAttribute,
  ReplicableProductVariant,
  ReplicableProductVariantValue,
  TiendanubeCreateProductDto,
  TiendanubeCreateProductVariantDto,
} from './tiendanube-replication.types';

const MAX_IMAGES = 9;
const MAX_ATTRIBUTES = 3;
const INVALID_PRODUCT_MESSAGE =
  'No se pudo construir el producto para Tiendanube';

export class MercadoLibreToTiendanubeMapper {
  static map(value: unknown): TiendanubeCreateProductDto {
    try {
      return mapProduct(parseProduct(value));
    } catch {
      invalidProduct();
    }
  }
}

function parseProduct(value: unknown): ReplicableProduct {
  if (!isJsonObject(value)) invalidProduct();

  const title = nonEmptyString(value.title);
  if (!title) invalidProduct();

  const description = parseDescription(value.description);
  const images = parseImages(value.images);
  const attributes = parseAttributes(value.attributes);
  const variants = parseVariants(value.variants, attributes);

  return { title, description, images, attributes, variants };
}

function parseDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalidProduct();
  return value.trim() || null;
}

function parseImages(value: unknown): readonly string[] {
  if (!Array.isArray(value)) invalidProduct();

  const uniqueImages: string[] = [];
  const seen = new Set<string>();

  for (const image of value) {
    const normalized = nonEmptyString(image);
    if (!normalized) invalidProduct();
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    if (uniqueImages.length < MAX_IMAGES) uniqueImages.push(normalized);
  }

  return uniqueImages;
}

function parseAttributes(
  value: unknown,
): readonly ReplicableProductAttribute[] {
  if (!Array.isArray(value) || value.length > MAX_ATTRIBUTES) {
    invalidProduct();
  }

  const attributes: ReplicableProductAttribute[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const candidate of value) {
    if (!isJsonObject(candidate)) invalidProduct();

    const id = nonEmptyString(candidate.id);
    const name = nonEmptyString(candidate.name);
    if (!id || !name) invalidProduct();

    const normalizedName = name.toLowerCase();
    if (ids.has(id) || names.has(normalizedName)) invalidProduct();

    ids.add(id);
    names.add(normalizedName);
    attributes.push({ id, name });
  }

  return attributes;
}

function parseVariants(
  value: unknown,
  attributes: readonly ReplicableProductAttribute[],
): readonly ReplicableProductVariant[] {
  if (!Array.isArray(value) || value.length === 0) invalidProduct();

  const variants: ReplicableProductVariant[] = [];
  const combinations = new Set<string>();

  for (const candidate of value) {
    const variant = parseVariant(candidate, attributes);
    const orderedValues = orderValues(variant.values, attributes);
    const combination = JSON.stringify(
      orderedValues.map(({ value: variantValue }) => variantValue),
    );
    if (combinations.has(combination)) invalidProduct();

    combinations.add(combination);
    variants.push({ ...variant, values: orderedValues });
  }

  return variants;
}

function parseVariant(
  value: unknown,
  attributes: readonly ReplicableProductAttribute[],
): ReplicableProductVariant {
  if (!isJsonObject(value)) invalidProduct();

  const price = value.price;
  const stock = value.stock;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    invalidProduct();
  }
  if (typeof stock !== 'number' || !Number.isSafeInteger(stock) || stock < 0) {
    invalidProduct();
  }

  const sku = parseSku(value.sku);
  const values = parseVariantValues(value.values);
  if (values.length !== attributes.length) invalidProduct();

  return { price, stock, sku, values };
}

function parseSku(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalidProduct();
  return value.trim() || null;
}

function parseVariantValues(
  value: unknown,
): readonly ReplicableProductVariantValue[] {
  if (!Array.isArray(value)) invalidProduct();

  return value.map((candidate) => {
    if (!isJsonObject(candidate)) invalidProduct();

    const attributeId = nonEmptyString(candidate.attributeId);
    const variantValue = nonEmptyString(candidate.value);
    if (!attributeId || !variantValue) invalidProduct();

    return { attributeId, value: variantValue };
  });
}

function orderValues(
  values: readonly ReplicableProductVariantValue[],
  attributes: readonly ReplicableProductAttribute[],
): readonly ReplicableProductVariantValue[] {
  const byAttributeId = new Map<string, ReplicableProductVariantValue>();

  for (const value of values) {
    if (byAttributeId.has(value.attributeId)) invalidProduct();
    byAttributeId.set(value.attributeId, value);
  }

  return attributes.map((attribute) => {
    const value = byAttributeId.get(attribute.id);
    if (!value) invalidProduct();
    return value;
  });
}

function mapProduct(product: ReplicableProduct): TiendanubeCreateProductDto {
  return {
    name: { es: product.title },
    ...(product.description
      ? { description: { es: plainTextToSafeHtml(product.description) } }
      : {}),
    visibility: 'hidden',
    images: product.images.map((src) => ({ src })),
    attributes: product.attributes.map(({ name }) => ({ es: name })),
    variants: product.variants.map(mapVariant),
  };
}

function plainTextToSafeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll(/\r\n?|\n/g, '<br>');
}

function mapVariant(
  variant: ReplicableProductVariant,
): TiendanubeCreateProductVariantDto {
  return {
    price: variant.price.toFixed(2),
    stock_management: true,
    stock: variant.stock,
    ...(variant.sku ? { sku: variant.sku } : {}),
    ...(variant.values.length > 0
      ? { values: variant.values.map(({ value }) => ({ es: value })) }
      : {}),
  };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidProduct(): never {
  throw new BadGatewayException(INVALID_PRODUCT_MESSAGE);
}
