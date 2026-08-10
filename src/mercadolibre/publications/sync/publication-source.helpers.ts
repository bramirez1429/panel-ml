import { BadGatewayException } from '@nestjs/common';
import { sanitizeMercadoLibreData } from '../../shared/mercadolibre-api.service';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';
import {
  MercadoLibrePublication,
  PublicationSourceError,
  PublicationSourceResult,
} from '../publication.types';

type MultigetEntry = { code?: unknown; body?: unknown };

/** Divide una lista en grupos del tamaño indicado. */
export function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/** Valida los IDs devueltos por una búsqueda. */
export function parseSearchIds(data: unknown): string[] {
  if (data === null) return [];
  if (!isJsonObject(data)) throw invalidSearchResponse();
  if (data.results === null) return [];
  if (!Array.isArray(data.results)) throw invalidSearchResponse();

  const results: unknown[] = data.results;
  if (results.some((id) => !isNonEmptyString(id))) {
    throw invalidSearchResponse();
  }
  return results.filter(isNonEmptyString);
}

/** Lee el primer scroll_id de una búsqueda scan. */
export function parseScrollId(data: unknown): string {
  if (!isJsonObject(data) || !isNonEmptyString(data.scroll_id)) {
    throw new BadGatewayException('Mercado Libre no devolvió scroll_id');
  }
  return data.scroll_id;
}

/** Lee el total informado por una búsqueda paginada. */
export function parseSearchTotal(data: unknown): number {
  if (!isJsonObject(data) || !isJsonObject(data.paging)) {
    throw invalidSearchResponse();
  }
  const total = data.paging.total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
    throw invalidSearchResponse();
  }
  return total;
}

/** Convierte la respuesta verbose del multiget en datos y errores. */
export function parseMultiget(
  requestedIds: string[],
  data: unknown,
): PublicationSourceResult {
  if (!Array.isArray(data)) {
    throw new BadGatewayException('Respuesta multiget inválida');
  }

  const entries = indexEntries(requestedIds, data);
  const publications: MercadoLibrePublication[] = [];
  const errors: PublicationSourceError[] = [];

  for (const itemId of requestedIds) {
    const entry = entries.get(itemId);
    if (!entry) {
      errors.push({ itemId, status: 502, body: 'Respuesta faltante' });
      continue;
    }
    const status = validStatus(entry.code) ? entry.code : 502;
    const body = entry.body ?? null;
    if (status === 200 && isJsonObject(body) && body.id === itemId) {
      publications.push(sanitizeMercadoLibreData(body));
    } else {
      errors.push({
        itemId,
        status,
        body: sanitizeMercadoLibreData(body),
      });
    }
  }
  return { publications, errors };
}

/** Indexa cada respuesta multiget por el ID solicitado. */
function indexEntries(
  requestedIds: string[],
  data: unknown[],
): Map<string, MultigetEntry> {
  const entries = new Map<string, MultigetEntry>();
  data.forEach((rawEntry, index) => {
    if (!isJsonObject(rawEntry)) return;
    const body = rawEntry.body;
    const itemId =
      isJsonObject(body) && isNonEmptyString(body.id)
        ? body.id
        : requestedIds[index];
    if (itemId && !entries.has(itemId)) entries.set(itemId, rawEntry);
  });
  return entries;
}

/** Indica si un valor es un estado HTTP. */
function validStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

/** Crea el error común para búsquedas mal formadas. */
function invalidSearchResponse(): BadGatewayException {
  return new BadGatewayException('Respuesta de publicaciones inválida');
}
