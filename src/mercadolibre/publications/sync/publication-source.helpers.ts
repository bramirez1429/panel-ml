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

type MultigetEntry = {
  id?: unknown;
  status_code?: unknown;
  code?: unknown;
  body?: unknown;
};

export type ParsedMultiget = PublicationSourceResult & {
  fallbackItemIds: string[];
  diagnostics: MultigetDiagnostics;
};

export type MultigetDiagnostics = {
  responseType: 'array' | 'other';
  entriesWithStatusCode: number;
  realHttpStatuses: Record<string, number>;
};

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
): ParsedMultiget {
  if (!Array.isArray(data)) {
    return {
      publications: [],
      errors: [],
      fallbackItemIds: [...requestedIds],
      diagnostics: {
        responseType: 'other',
        entriesWithStatusCode: 0,
        realHttpStatuses: {},
      },
    };
  }

  const entries = indexEntries(requestedIds, data);
  const publications: MercadoLibrePublication[] = [];
  const errors: PublicationSourceError[] = [];
  const fallbackItemIds: string[] = [];
  const realHttpStatuses: Record<string, number> = {};

  for (const itemId of requestedIds) {
    const entry = entries.get(itemId);
    if (!entry) {
      fallbackItemIds.push(itemId);
      continue;
    }
    const status = entryStatus(entry);
    const body = entry.body ?? null;
    if (
      status === 200 &&
      hasExpectedEntryId(entry, itemId) &&
      isJsonObject(body) &&
      body.id === itemId
    ) {
      publications.push(sanitizeMercadoLibreData(body));
    } else if (status === 200 || !hasStatus(entry)) {
      fallbackItemIds.push(itemId);
    } else {
      errors.push({
        itemId,
        status,
        body: sanitizeMercadoLibreData(body),
      });
      const statusKey = String(status);
      realHttpStatuses[statusKey] = (realHttpStatuses[statusKey] ?? 0) + 1;
    }
  }
  return {
    publications,
    errors,
    fallbackItemIds,
    diagnostics: {
      responseType: 'array',
      entriesWithStatusCode: data.filter(
        (entry) => isJsonObject(entry) && validStatus(entry.status_code),
      ).length,
      realHttpStatuses,
    },
  };
}

/** Indexa cada respuesta multiget por el ID solicitado. */
function indexEntries(
  requestedIds: string[],
  data: unknown[],
): Map<string, MultigetEntry> {
  const entries = new Map<string, MultigetEntry>();
  data.forEach((rawEntry, index) => {
    if (!isJsonObject(rawEntry)) return;
    const itemId = entryId(rawEntry) ?? requestedIds[index];
    if (itemId && !entries.has(itemId)) entries.set(itemId, rawEntry);
  });
  return entries;
}

/** Lee el identificador del formato bulk y conserva el multiget anterior. */
function entryId(entry: MultigetEntry): string | undefined {
  if (isNonEmptyString(entry.id)) return entry.id;
  if (isJsonObject(entry.body) && isNonEmptyString(entry.body.id)) {
    return entry.body.id;
  }
  return undefined;
}

/** Lee status_code del bulk y conserva code del multiget anterior. */
function entryStatus(entry: MultigetEntry): number {
  if (validStatus(entry.status_code)) return entry.status_code;
  return validStatus(entry.code) ? entry.code : 200;
}

/** Distingue una entrada sin estado de un error HTTP informado por Mercado Libre. */
function hasStatus(entry: MultigetEntry): boolean {
  return validStatus(entry.status_code) || validStatus(entry.code);
}

/** Exige el id raíz del contrato bulk y acepta body.id en el formato anterior. */
function hasExpectedEntryId(entry: MultigetEntry, itemId: string): boolean {
  if (validStatus(entry.status_code)) return entry.id === itemId;
  return entryId(entry) === itemId;
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
