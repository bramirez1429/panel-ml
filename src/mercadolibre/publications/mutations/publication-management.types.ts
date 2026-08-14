import { BadGatewayException, BadRequestException } from '@nestjs/common';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';

export type PublicationManagementTarget = Readonly<{
  productId: string;
  model: 'SHARED' | 'VARIANT_PRICING';
  itemId: string;
  userProductId: string | null;
}>;

export type ManagedPicture = Readonly<{
  id: string;
  url: string | null;
  secureUrl: string | null;
}>;

export type UploadedPictureFile = Readonly<{
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}>;

export type LiveAttribute = Record<string, unknown> & {
  id?: unknown;
  value_name?: unknown;
};

export type LiveVariation = Record<string, unknown> & {
  id: string | number;
  attributes: LiveAttribute[];
  picture_ids: string[];
};

export function parseOptionalItemId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isNonEmptyString(value) || !/^MLA\d+$/.test(value.trim())) {
    throw new BadRequestException('itemId debe comenzar con MLA');
  }
  return value.trim();
}

export function parseVariationId(value: unknown): string {
  const normalized = identifier(value);
  if (!normalized) {
    throw new BadRequestException('variationId es invalido');
  }
  return normalized;
}

export function parseLiveAttributes(value: unknown): LiveAttribute[] {
  if (!Array.isArray(value)) {
    throw new BadGatewayException('Atributos de Mercado Libre invalidos');
  }
  const candidates: unknown[] = value;
  return candidates.map((attribute) => {
    if (!isJsonObject(attribute)) {
      throw new BadGatewayException('Atributos de Mercado Libre invalidos');
    }
    return { ...attribute };
  });
}

export function parseLiveVariations(value: unknown): LiveVariation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadGatewayException('Variaciones de Mercado Libre invalidas');
  }
  const variations = value.map((candidate) => {
    if (!isJsonObject(candidate)) {
      throw new BadGatewayException('Variaciones de Mercado Libre invalidas');
    }
    const id = identifier(candidate.id);
    if (
      !id ||
      (typeof candidate.id !== 'string' && typeof candidate.id !== 'number')
    ) {
      throw new BadGatewayException('Variaciones de Mercado Libre invalidas');
    }
    if (!Array.isArray(candidate.picture_ids)) {
      throw new BadGatewayException('Imagenes de variaciones invalidas');
    }
    const rawPictureIds: unknown[] = candidate.picture_ids;
    const pictureIds = rawPictureIds.map((pictureId) => {
      if (!isNonEmptyString(pictureId)) {
        throw new BadGatewayException('Imagenes de variaciones invalidas');
      }
      return pictureId.trim();
    });
    return {
      ...candidate,
      id: candidate.id,
      attributes: parseLiveAttributes(candidate.attributes ?? []),
      picture_ids: pictureIds,
    };
  });
  if (
    new Set(variations.map(({ id }) => String(id))).size !== variations.length
  ) {
    throw new BadGatewayException('Variaciones de Mercado Libre duplicadas');
  }
  return variations;
}

export function parseLivePictures(value: unknown): ManagedPicture[] {
  if (!Array.isArray(value)) {
    throw new BadGatewayException('Imagenes de Mercado Libre invalidas');
  }
  return value.map((candidate) => {
    if (!isJsonObject(candidate) || !isNonEmptyString(candidate.id)) {
      throw new BadGatewayException('Imagenes de Mercado Libre invalidas');
    }
    return {
      id: candidate.id.trim(),
      url: text(candidate.url),
      secureUrl: text(candidate.secure_url),
    };
  });
}

export function sellerSku(attributes: readonly LiveAttribute[]): string | null {
  const attribute = attributes.find(
    (candidate) =>
      typeof candidate.id === 'string' &&
      candidate.id.toUpperCase() === 'SELLER_SKU',
  );
  return attribute ? text(attribute.value_name) : null;
}

export function replaceSellerSku(
  attributes: readonly LiveAttribute[],
  value: string,
): LiveAttribute[] {
  const next = attributes.map((attribute) => ({ ...attribute }));
  const index = next.findIndex(
    (attribute) =>
      typeof attribute.id === 'string' &&
      attribute.id.toUpperCase() === 'SELLER_SKU',
  );
  const replacement = { id: 'SELLER_SKU', value_name: value };
  if (index === -1) next.push(replacement);
  else next[index] = replacement;
  return next;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'string' && /^\d+$/.test(value.trim()))
    return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return null;
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}
