import { BadGatewayException } from '@nestjs/common';

import type {
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidProductsResponse(): never {
  throw new BadGatewayException(INVALID_PRODUCTS_MESSAGE);
}
