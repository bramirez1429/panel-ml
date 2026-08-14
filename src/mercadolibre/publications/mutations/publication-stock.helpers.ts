import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreProductDetail } from '../../../database/repositories/mercadolibre-publications.types';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { PublicationManagementContext } from './publication-management-target.service';
import { parseOptionalItemId } from './publication-management.types';
import {
  normalizePublicationVariationId,
  PublicationUpdateVariation,
} from './publication-update-variations.helpers';

export type PublicationStockInput = Readonly<{
  stock: number;
  itemId: string | null;
  variationId: string | null;
}>;

/** Valida el body de stock y normaliza sus identificadores opcionales. */
export function parsePublicationStockInput(
  body: unknown,
): PublicationStockInput {
  if (
    !isJsonObject(body) ||
    typeof body.stock !== 'number' ||
    !Number.isSafeInteger(body.stock) ||
    body.stock < 0
  ) {
    throw new BadRequestException(
      'stock debe ser un entero mayor o igual que cero',
    );
  }
  const variationId =
    body.variationId === undefined || body.variationId === null
      ? null
      : normalizePublicationVariationId(body.variationId);
  if (body.variationId != null && !variationId) {
    throw new BadRequestException('variationId es inválido');
  }
  return {
    stock: body.stock,
    itemId: parseOptionalItemId(body.itemId),
    variationId,
  };
}

/** Comprueba que el selector pertenezca al modelo y snapshot guardados. */
export function validatePublicationStockSelector(
  product: MercadolibreProductDetail,
  variationId: string | null,
): void {
  if (product.model === 'VARIANT_PRICING') {
    if (variationId) {
      throw new BadRequestException(
        'variationId no corresponde a VARIANT_PRICING',
      );
    }
    return;
  }
  if (
    variationId &&
    !storedVariationIds(product.shared_variations).has(variationId)
  ) {
    throw new NotFoundException(
      'La variación no pertenece a la publicación SHARED',
    );
  }
}

/** Construye un PUT que preserva IDs pero sólo cambia la variation seleccionada. */
export function createItemStockPayload(
  input: PublicationStockInput,
  variations: PublicationUpdateVariation[],
): Record<string, unknown> {
  if (variations.length === 0) {
    if (input.variationId) throw missingVariationError();
    return { available_quantity: input.stock };
  }
  if (!input.variationId) {
    throw new BadRequestException(
      'variationId es obligatorio para una publicación con variaciones',
    );
  }
  if (!variations.some(({ id }) => id === input.variationId)) {
    throw missingVariationError();
  }
  return {
    variations: variations.map(({ id, rawId }) => ({
      id: rawId,
      ...(id === input.variationId ? { available_quantity: input.stock } : {}),
    })),
  };
}

/** Obtiene el User Product seguro que corresponde al stock solicitado. */
export function publicationStockUserProductId(
  context: PublicationManagementContext,
  input: PublicationStockInput,
  variations: PublicationUpdateVariation[],
): string | null {
  if (context.target.model === 'VARIANT_PRICING') {
    return context.target.userProductId;
  }
  return (
    variations.find(({ id }) => id === input.variationId)?.userProductId ?? null
  );
}

/** Extrae tipos de ubicación y trata 404 o ausencia como stock por item. */
export function parsePublicationStockLocations(value: unknown): string[] {
  if (value === null) return [];
  if (!isJsonObject(value) || value.locations === undefined) return [];
  if (!Array.isArray(value.locations)) throw invalidLocationsError();

  return value.locations.map((location) => {
    if (!isJsonObject(location) || typeof location.type !== 'string') {
      throw invalidLocationsError();
    }
    return location.type;
  });
}

/** Crea el error público para stock administrado por depósitos. */
export function publicationWarehouseError(): ConflictException {
  return new ConflictException(
    'Esta publicación administra el stock por depósito',
  );
}

// Obtiene los IDs de variaciones del snapshot local.
function storedVariationIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.flatMap((candidate) => {
      if (!isJsonObject(candidate)) return [];
      const id = normalizePublicationVariationId(candidate.id);
      return id ? [id] : [];
    }),
  );
}

// Crea el error seguro para una variación viva ausente.
function missingVariationError(): NotFoundException {
  return new NotFoundException('La variación ya no existe en Mercado Libre');
}

// Crea el error seguro para ubicaciones externas inválidas.
function invalidLocationsError(): BadGatewayException {
  return new BadGatewayException(
    'Mercado Libre devolvió ubicaciones de stock inválidas',
  );
}
