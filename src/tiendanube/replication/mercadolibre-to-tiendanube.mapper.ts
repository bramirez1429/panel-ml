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

/** Error local y determinista: no representa una respuesta 502 de una API. */
export class TiendanubeProductValidationError extends Error {
  constructor(readonly code: string) {
    super(`${INVALID_PRODUCT_MESSAGE}: ${code}`);
    this.name = TiendanubeProductValidationError.name;
  }
}

export class MercadoLibreToTiendanubeMapper {
  static map(value: unknown): TiendanubeCreateProductDto {
    return mapProduct(parseProduct(value));
  }
}

function parseProduct(value: unknown): ReplicableProduct {
  if (!isJsonObject(value)) invalidProduct('PRODUCT_NOT_OBJECT');

  const title = nonEmptyString(value.title);
  if (!title) invalidProduct('TITLE_REQUIRED');

  const description = parseDescription(value.description);
  const images = parseImages(value.images);
  const attributes = parseAttributes(value.attributes);
  const variants = parseVariants(value.variants, attributes, images);
  const brand = parseOptionalText(value.brand);
  const categoryIds = parseCategoryIds(value.categoryIds);
  const tags = parseTags(value.tags);
  const seoTitle = parseOptionalText(value.seoTitle);
  const seoDescription = parseOptionalText(value.seoDescription);

  return {
    title,
    description,
    images,
    attributes,
    variants,
    brand,
    categoryIds,
    tags,
    seoTitle,
    seoDescription,
  };
}

function parseDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalidProduct('DESCRIPTION_INVALID');
  return value.trim() || null;
}

function parseImages(value: unknown): readonly string[] {
  if (!Array.isArray(value)) invalidProduct('IMAGES_INVALID');

  const uniqueImages: string[] = [];
  const seen = new Set<string>();

  for (const image of value) {
    const normalized = nonEmptyString(image);
    if (!normalized) invalidProduct('IMAGE_SOURCE_INVALID');
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
    invalidProduct('ATTRIBUTES_INVALID');
  }

  const attributes: ReplicableProductAttribute[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const candidate of value) {
    if (!isJsonObject(candidate)) invalidProduct('ATTRIBUTE_INVALID');

    const id = nonEmptyString(candidate.id);
    const name = nonEmptyString(candidate.name);
    if (!id || !name) invalidProduct('ATTRIBUTE_ID_OR_NAME_INVALID');

    const normalizedName = name.toLowerCase();
    if (ids.has(id) || names.has(normalizedName)) invalidProduct('ATTRIBUTE_DUPLICATED');

    ids.add(id);
    names.add(normalizedName);
    attributes.push({ id, name });
  }

  return attributes;
}

function parseVariants(
  value: unknown,
  attributes: readonly ReplicableProductAttribute[],
  images: readonly string[],
): readonly ReplicableProductVariant[] {
  if (!Array.isArray(value) || value.length === 0)
    invalidProduct('VARIANTS_REQUIRED');

  const variants: ReplicableProductVariant[] = [];
  const combinations = new Set<string>();

  for (const candidate of value) {
    const variant = parseVariant(candidate, attributes, images);
    const orderedValues = orderValues(variant.values, attributes);
    const combination = JSON.stringify(
      orderedValues.map(({ value: variantValue }) => variantValue),
    );
    if (combinations.has(combination)) invalidProduct('VARIANT_COMBINATION_DUPLICATED');

    combinations.add(combination);
    variants.push({ ...variant, values: orderedValues });
  }

  return variants;
}

function parseVariant(
  value: unknown,
  attributes: readonly ReplicableProductAttribute[],
  images: readonly string[],
): ReplicableProductVariant {
  if (!isJsonObject(value)) invalidProduct('VARIANT_INVALID');

  const price = value.price;
  const stock = value.stock;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    invalidProduct('VARIANT_PRICE_INVALID');
  }
  if (typeof stock !== 'number' || !Number.isSafeInteger(stock) || stock < 0) {
    invalidProduct('VARIANT_STOCK_INVALID');
  }

  const sku = parseSku(value.sku);
  const imageSrc = parseOptionalText(value.imageSrc);
  if (imageSrc && !images.includes(imageSrc)) invalidProduct('VARIANT_IMAGE_INVALID');
  const values = parseVariantValues(value.values);
  if (values.length !== attributes.length)
    invalidProduct('VARIANT_VALUES_COUNT_INVALID');

  return {
    price,
    stock,
    sku,
    ...(imageSrc ? { imageSrc } : {}),
    ...parseVariantDimensions(value),
    values,
  };
}

function parseVariantDimensions(value: Record<string, unknown>): {
  weight?: number;
  width?: number;
  height?: number;
  depth?: number;
} {
  const dimensions = ['weight', 'width', 'height', 'depth'] as const;
  const result: {
    weight?: number;
    width?: number;
    height?: number;
    depth?: number;
  } = {};
  for (const dimension of dimensions) {
    const raw = value[dimension];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      invalidProduct('VARIANT_DIMENSION_INVALID');
    }
    result[dimension] = raw;
  }
  return result;
}

function parseSku(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalidProduct('SKU_INVALID');
  return value.trim() || null;
}

function parseOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalidProduct('OPTIONAL_TEXT_INVALID');
  return value.trim() || null;
}

function parseCategoryIds(value: unknown): readonly number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) invalidProduct('CATEGORIES_INVALID');
  const ids = value.map((candidate) => {
    if (
      typeof candidate !== 'number' ||
      !Number.isSafeInteger(candidate) ||
      candidate <= 0
    ) {
      invalidProduct('CATEGORY_ID_INVALID');
    }
    return candidate;
  });
  return [...new Set(ids)];
}

function parseTags(value: unknown): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) invalidProduct('TAGS_INVALID');
  const tags = value.map((candidate) => {
    const tag = nonEmptyString(candidate);
    if (!tag) invalidProduct('TAG_INVALID');
    return tag;
  });
  return [...new Set(tags)];
}

function parseVariantValues(
  value: unknown,
): readonly ReplicableProductVariantValue[] {
  if (!Array.isArray(value)) invalidProduct('VARIANT_VALUES_INVALID');

  return value.map((candidate) => {
    if (!isJsonObject(candidate)) invalidProduct('VARIANT_VALUE_INVALID');

    const attributeId = nonEmptyString(candidate.attributeId);
    const variantValue = nonEmptyString(candidate.value);
    if (!attributeId || !variantValue)
      invalidProduct('VARIANT_VALUE_REQUIRED');

    return { attributeId, value: variantValue };
  });
}

function orderValues(
  values: readonly ReplicableProductVariantValue[],
  attributes: readonly ReplicableProductAttribute[],
): readonly ReplicableProductVariantValue[] {
  const byAttributeId = new Map<string, ReplicableProductVariantValue>();

  for (const value of values) {
    if (byAttributeId.has(value.attributeId))
      invalidProduct('VARIANT_ATTRIBUTE_DUPLICATED');
    byAttributeId.set(value.attributeId, value);
  }

  return attributes.map((attribute) => {
    const value = byAttributeId.get(attribute.id);
    if (!value) invalidProduct('VARIANT_ATTRIBUTE_VALUE_MISSING');
    return value;
  });
}

function mapProduct(product: ReplicableProduct): TiendanubeCreateProductDto {
  return {
    name: { es: product.title },
    ...(product.description
      ? { description: { es: plainTextToSafeHtml(product.description) } }
      : {}),
    visibility: 'visible',
    images: product.images.map((src) => ({ src })),
    attributes: product.attributes.map(({ name }) => ({ es: name })),
    brand: 'SAEL',
    ...(product.categoryIds && product.categoryIds.length > 0
      ? { categories: product.categoryIds }
      : {}),
    ...(product.tags && product.tags.length > 0
      ? { tags: product.tags.join(',') }
      : {}),
    seo_title: truncate(product.seoTitle ?? product.title, 70),
    ...(product.seoDescription || product.description
      ? {
          seo_description: truncate(
            product.seoDescription ?? product.description ?? '',
            320,
          ),
        }
      : {}),
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
    ...(variant.imageSrc ? { imageSrc: variant.imageSrc } : {}),
    ...(variant.weight !== undefined && variant.weight !== null
      ? { weight: variant.weight.toFixed(2) }
      : {}),
    ...(variant.width !== undefined && variant.width !== null
      ? { width: variant.width.toFixed(2) }
      : {}),
    ...(variant.height !== undefined && variant.height !== null
      ? { height: variant.height.toFixed(2) }
      : {}),
    ...(variant.depth !== undefined && variant.depth !== null
      ? { depth: variant.depth.toFixed(2) }
      : {}),
    ...(variant.values.length > 0
      ? { values: variant.values.map(({ value }) => ({ es: value })) }
      : {}),
  };
}

function truncate(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidProduct(code = 'INVALID_PRODUCT_DATA'): never {
  throw new TiendanubeProductValidationError(code);
}
