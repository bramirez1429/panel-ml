import { BadGatewayException } from '@nestjs/common';

import type {
  TiendanubeCatalogProductResponse,
  TiendanubeCatalogProductVariantResponse,
  TiendanubeLocalizedText,
  TiendanubeProductImageResponse,
  TiendanubeProductResponse,
  TiendanubeProductVariantResponse,
} from './tiendanube-product.types';

const INVALID_PRODUCTS_MESSAGE =
  'Tiendanube devolvió una respuesta de productos inválida';
const LOCALE_KEY_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/u;

export class TiendanubeProductMapper {
  static mapList(value: unknown): readonly TiendanubeProductResponse[] {
    try {
      if (!Array.isArray(value)) invalidProductsResponse();
      return value.map(mapProduct);
    } catch {
      invalidProductsResponse();
    }
  }

  static mapCatalogList(
    value: unknown,
  ): readonly TiendanubeCatalogProductResponse[] {
    try {
      if (!Array.isArray(value)) invalidProductsResponse();
      return value.map(mapCatalogProduct);
    } catch {
      invalidProductsResponse();
    }
  }
}

function mapProduct(value: unknown): TiendanubeProductResponse {
  if (
    !isJsonObject(value) ||
    !isPositiveSafeInteger(value.id) ||
    typeof value.published !== 'boolean' ||
    !Array.isArray(value.variants) ||
    !Array.isArray(value.images)
  ) {
    invalidProductsResponse();
  }

  return {
    id: value.id,
    name: mapLocalizedText(value.name),
    published: value.published,
    variants: value.variants.map(mapVariant),
    images: value.images.map(mapImage),
  };
}

function mapCatalogProduct(value: unknown): TiendanubeCatalogProductResponse {
  if (
    !isJsonObject(value) ||
    !isPositiveSafeInteger(value.id) ||
    !Array.isArray(value.variants)
  ) {
    invalidProductsResponse();
  }

  const publication = mapPublication(value);
  const attributes = mapProductAttributes(value.attributes);

  return {
    id: value.id,
    name: mapLocalizedText(value.name),
    mainImage: mapMainImage(value.images),
    tags: mapTags(value.tags),
    ...publication,
    variants: value.variants.map((variant) =>
      mapCatalogVariant(variant, attributes),
    ),
  };
}

function mapLocalizedText(value: unknown): TiendanubeLocalizedText {
  if (!isJsonObject(value)) invalidProductsResponse();

  const entries = Object.entries(value);
  if (entries.length === 0) invalidProductsResponse();

  const localizedText: Record<string, string> = {};
  for (const [locale, translation] of entries) {
    if (
      !LOCALE_KEY_PATTERN.test(locale) ||
      typeof translation !== 'string' ||
      translation.trim().length === 0
    ) {
      invalidProductsResponse();
    }

    localizedText[locale] = translation;
  }

  return localizedText;
}

function mapVariant(value: unknown): TiendanubeProductVariantResponse {
  if (!isJsonObject(value) || !isPositiveSafeInteger(value.id)) {
    invalidProductsResponse();
  }

  return { id: value.id };
}

function mapImage(value: unknown): TiendanubeProductImageResponse {
  if (
    !isJsonObject(value) ||
    !isPositiveSafeInteger(value.id) ||
    typeof value.src !== 'string' ||
    value.src.trim().length === 0 ||
    !isPositiveSafeInteger(value.position)
  ) {
    invalidProductsResponse();
  }

  return {
    id: value.id,
    src: value.src,
    position: value.position,
  };
}

function mapPublication(value: Record<string, unknown>): Readonly<{
  published: boolean;
  visibility: 'visible' | 'unlisted' | 'hidden';
}> {
  const visibility = value.visibility;
  const published = value.published;
  const hasVisibility =
    visibility === 'visible' ||
    visibility === 'unlisted' ||
    visibility === 'hidden';

  if (published !== undefined && typeof published !== 'boolean') {
    invalidProductsResponse();
  }
  if (visibility !== undefined && visibility !== null && !hasVisibility) {
    invalidProductsResponse();
  }
  if (typeof published !== 'boolean' && !hasVisibility) {
    invalidProductsResponse();
  }

  return {
    published:
      typeof published === 'boolean' ? published : visibility === 'visible',
    visibility: hasVisibility ? visibility : published ? 'visible' : 'hidden',
  };
}

function mapProductAttributes(
  value: unknown,
): readonly TiendanubeLocalizedText[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalidProductsResponse();
  return value.map(mapLocalizedText);
}

function mapCatalogVariant(
  value: unknown,
  productAttributes: readonly TiendanubeLocalizedText[],
): TiendanubeCatalogProductVariantResponse {
  if (
    !isJsonObject(value) ||
    !isPositiveSafeInteger(value.id) ||
    typeof value.stock_management !== 'boolean'
  ) {
    invalidProductsResponse();
  }

  return {
    id: value.id,
    attributes: mapVariantAttributes(value.values, productAttributes),
    sku: mapOptionalText(value.sku),
    stock: value.stock_management ? mapNullableNumber(value.stock) : null,
    stockManagement: value.stock_management,
    price: mapNullableNumber(value.price),
    promotionalPrice: mapNullableNumber(value.promotional_price),
  };
}

function mapVariantAttributes(
  value: unknown,
  productAttributes: readonly TiendanubeLocalizedText[],
): readonly Readonly<{
  name: TiendanubeLocalizedText | null;
  value: TiendanubeLocalizedText;
}>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalidProductsResponse();

  return value.map((attributeValue, index) => ({
    name: productAttributes[index] ?? null,
    value: mapLocalizedText(attributeValue),
  }));
}

function mapMainImage(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) invalidProductsResponse();

  const candidates = value
    .map((image, index) => {
      if (!isJsonObject(image) || typeof image.src !== 'string') return null;
      const src = image.src.trim();
      if (!src) return null;
      return {
        src,
        index,
        position:
          typeof image.position === 'number' && Number.isFinite(image.position)
            ? image.position
            : Number.MAX_SAFE_INTEGER,
      };
    })
    .filter(
      (image): image is { src: string; index: number; position: number } =>
        image !== null,
    )
    .sort(
      (left, right) =>
        left.position - right.position || left.index - right.index,
    );

  return candidates[0]?.src ?? null;
}

function mapTags(value: unknown): readonly string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }
  if (Array.isArray(value) && value.every((tag) => typeof tag === 'string')) {
    return value
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }
  invalidProductsResponse();
}

function mapOptionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalidProductsResponse();
  const text = value.trim();
  return text || null;
}

function mapNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) invalidProductsResponse();
  return number;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidProductsResponse(): never {
  throw new BadGatewayException(INVALID_PRODUCTS_MESSAGE);
}
