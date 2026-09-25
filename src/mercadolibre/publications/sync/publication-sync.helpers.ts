import {
  MercadoLibrePublication,
  PublicationSourceError,
  ResolvedVariantPublication,
} from '../publication.types';
import { PublicationSyncError } from './publication-sync.types';
import {
  classifyProviderResponse,
  classifySyncError,
} from './publication-sync-error-classifier';

/** Ejecuta tareas con una concurrencia máxima. */
export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += concurrency) {
    results.push(
      ...(await Promise.all(
        values.slice(index, index + concurrency).map(task),
      )),
    );
  }
  return results;
}

/** Lee un MLA válido desde una publicación externa. */
export function requireItemId(publication: MercadoLibrePublication): string {
  if (typeof publication.id !== 'string' || !/^MLA\d+$/.test(publication.id)) {
    throw new Error('La publicación no tiene un item_id válido');
  }
  return publication.id;
}

/** Lee el MLAU raíz requerido por el modelo nuevo. */
export function requireUserProductId(
  publication: MercadoLibrePublication,
): string {
  const value = publication.user_product_id;
  if (typeof value !== 'string' || !/^MLAU\d+$/.test(value)) {
    throw new Error('La publicación no tiene un user_product_id válido');
  }
  return value;
}

/** Agrupa publicaciones resueltas por family_id. */
export function groupByFamily(
  publications: ResolvedVariantPublication[],
): Map<string, ResolvedVariantPublication[]> {
  const families = new Map<string, ResolvedVariantPublication[]>();
  for (const publication of publications) {
    const current = families.get(publication.familyId) ?? [];
    current.push(publication);
    families.set(publication.familyId, current);
  }
  return families;
}

/** Separa publicaciones ajenas o sin vendedor antes de normalizar. */
export function filterPublicationsBySeller(
  publications: MercadoLibrePublication[],
  sellerId: number,
): {
  publications: MercadoLibrePublication[];
  errors: PublicationSyncError[];
} {
  const owned: MercadoLibrePublication[] = [];
  const errors: PublicationSyncError[] = [];

  for (const publication of publications) {
    if (publication.seller_id === sellerId) {
      owned.push(publication);
      continue;
    }
    let itemId = 'unknown-item';
    try {
      itemId = requireItemId(publication);
    } catch {
      // La referencia segura se conserva para el resumen.
    }
    errors.push({
      itemId,
      type: 'VALIDATION_ERROR',
      message: 'La publicaci\u00f3n no pertenece al vendedor conectado',
    });
  }
  return { publications: owned, errors };
}

/** Convierte un error multiget en un resumen seguro. */
export function sourceErrorToSyncError(
  error: PublicationSourceError,
): PublicationSyncError {
  const classified = classifyProviderResponse(error.status, error.body);
  return {
    itemId: error.itemId,
    type: classified.type,
    code: classified.code,
    message: classified.message,
  };
}

/** Convierte una excepción en un error sin credenciales. */
export function exceptionToSyncError(
  itemId: string,
  error: unknown,
): PublicationSyncError {
  const classified = classifySyncError(error);
  return {
    itemId,
    type: classified.type,
    code: classified.code,
    message: classified.message,
  };
}
