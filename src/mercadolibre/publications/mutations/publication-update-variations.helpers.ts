import { BadGatewayException } from '@nestjs/common';
import { isJsonObject } from '../../shared/mercadolibre.types';

export type PublicationUpdateVariation = Readonly<{
  id: string;
  rawId: string | number;
  availableQuantity: number;
  userProductId: string | null;
}>;

/** Normaliza las variaciones vivas sin omitir IDs del siguiente PUT. */
export function parsePublicationUpdateVariations(
  value: unknown,
): PublicationUpdateVariation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidVariations();

  const variations = value.map(parseVariation);
  const ids = variations.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new BadGatewayException(
      'Mercado Libre devolvió variaciones duplicadas',
    );
  }
  return variations;
}

/** Normaliza un ID externo entero o numérico como texto. */
export function normalizePublicationVariationId(value: unknown): string | null {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return null;
}

// Convierte una variación viva en el formato seguro usado por las mutaciones.
function parseVariation(value: unknown): PublicationUpdateVariation {
  if (!isJsonObject(value)) throw invalidVariations();

  const id = normalizePublicationVariationId(value.id);
  const validRawId =
    typeof value.id === 'string' || typeof value.id === 'number';
  const availableQuantity = value.available_quantity;
  if (
    !id ||
    !validRawId ||
    typeof availableQuantity !== 'number' ||
    !Number.isSafeInteger(availableQuantity) ||
    availableQuantity < 0
  ) {
    throw invalidVariations();
  }

  return {
    id,
    rawId: value.id as string | number,
    availableQuantity,
    userProductId: parseUserProductId(value.user_product_id),
  };
}

// Valida el User Product opcional informado por una variación viva.
function parseUserProductId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^MLAU\d+$/.test(value.trim())) {
    throw new BadGatewayException(
      'Mercado Libre devolvió un User Product inválido',
    );
  }
  return value.trim();
}

// Crea el error seguro para una lista de variaciones inválida.
function invalidVariations(): BadGatewayException {
  return new BadGatewayException(
    'Mercado Libre devolvió variaciones inválidas',
  );
}
