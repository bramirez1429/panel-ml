import type { PublicationAction } from '../activity/publication-activity.types';
import {
  publicationActionErrorMessage,
  PublicationActivityService,
} from '../activity/publication-activity.service';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';

export type PublicationMutationAudit = {
  sellerId: number;
  productId: string;
  itemId: string;
  action: PublicationAction;
  oldValue?: unknown;
  newValue?: unknown;
};

/** Ejecuta la mutacion y registra el resultado sin alterar el error original. */
export async function runAuditedPublicationMutation<T>(
  activity: PublicationActivityService,
  audit: PublicationMutationAudit,
  mutation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await mutation();
    await record(activity, audit, 'SUCCESS');
    return result;
  } catch (error) {
    await record(activity, audit, 'FAILED', error);
    throw error;
  }
}

/** Registra el fallo de un paso preparatorio que no constituye una mutacion completa. */
export function recordPublicationMutationFailure(
  activity: PublicationActivityService,
  audit: PublicationMutationAudit,
  error: unknown,
): Promise<void> {
  return record(activity, audit, 'FAILED', error);
}

async function record(
  activity: PublicationActivityService,
  audit: PublicationMutationAudit,
  status: 'SUCCESS' | 'FAILED',
  error?: unknown,
): Promise<void> {
  try {
    await activity.recordBestEffort({
      ...audit,
      status,
      errorMessage:
        error === undefined ? null : publicationActionErrorMessage(error),
    });
  } catch {
    // La auditoria nunca debe enmascarar el resultado de Mercado Libre.
  }
}

export function priceAuditValue(item: Record<string, unknown>): unknown {
  const variations = variationRows(item.variations).map(({ row, id }) => ({
    variationId: id,
    price: finiteNumber(row.price),
  }));
  return variations.length > 0
    ? { variations }
    : { price: finiteNumber(item.price) };
}

export function stockAuditValue(
  item: Record<string, unknown>,
  variationId: string | null,
): unknown {
  const variations = variationRows(item.variations).map(({ row, id }) => ({
    variationId: id,
    stock: nonNegativeInteger(row.available_quantity),
  }));
  if (variationId) {
    return (
      variations.find((variation) => variation.variationId === variationId) ?? {
        variationId,
        stock: null,
      }
    );
  }
  return variations.length > 0
    ? { variations }
    : { stock: nonNegativeInteger(item.available_quantity) };
}

export function skuAuditValue(
  item: Record<string, unknown>,
  variationId: string | null,
): unknown {
  const variations = variationRows(item.variations).map(({ row, id }) => ({
    variationId: id,
    sku: sellerSku(row.attributes),
  }));
  if (variationId) {
    return (
      variations.find((variation) => variation.variationId === variationId) ?? {
        variationId,
        sku: null,
      }
    );
  }
  return variations.length > 0
    ? { variations }
    : { sku: sellerSku(item.attributes) };
}

export function picturesAuditValue(item: Record<string, unknown>): unknown {
  return {
    pictureIds: pictureIds(item.pictures),
    variations: variationRows(item.variations).map(({ row, id }) => ({
      variationId: id,
      pictureIds: stringArray(row.picture_ids),
    })),
  };
}

function variationRows(value: unknown): Array<{
  row: Record<string, unknown>;
  id: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isJsonObject(row)) return [];
    const id = normalizeId(row.id);
    return id ? [{ row, id }] : [];
  });
}

function normalizeId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function sellerSku(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const candidates: unknown[] = value;
  const attribute = candidates.find(
    (candidate) => isJsonObject(candidate) && candidate.id === 'SELLER_SKU',
  );
  if (!isJsonObject(attribute)) return null;
  return isNonEmptyString(attribute.value_name)
    ? attribute.value_name.trim()
    : null;
}

function pictureIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isJsonObject(candidate) || !isNonEmptyString(candidate.id)) return [];
    return [candidate.id.trim()];
  });
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) =>
    isNonEmptyString(candidate) ? [candidate.trim()] : [],
  );
}
