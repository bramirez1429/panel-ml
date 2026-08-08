import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import {
  MercadolibreApiService,
  sanitizeMercadoLibreData,
} from '../shared/mercadolibre-api.service';
import { isJsonObject, isNonEmptyString } from '../shared/mercadolibre.types';
import { PublicationGroupsService } from './publication-groups.service';
import {
  MercadoLibrePublication,
  PublicationDetails,
  PublicationError,
  PublicationPage,
} from './publication.types';

const SCAN_SIZE = 100;
const MULTIGET_SIZE = 20;
const MAX_CONCURRENT_REQUESTS = 4;

type MultigetEntry = {
  code?: unknown;
  body?: unknown;
};

@Injectable()
export class PublicationsService {
  /** Recibe acceso a tokens, API y agrupamiento. */
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly groupsService: PublicationGroupsService,
  ) {}

  /** Obtiene, agrupa y pagina los productos para la tabla. */
  async getPublicationsPage(page = 1, limit = 20): Promise<PublicationPage> {
    this.validatePaging(page, limit);

    const connection = await this.tokenService.getStoredConnection();
    const accessToken = await this.tokenService.getValidAccessToken(connection);
    const ids = await this.getAllPublicationIds(
      connection.seller_id,
      accessToken,
    );
    const details = await this.getPublicationDetails(ids, accessToken);
    const rows = await this.groupsService.buildPublicationRows(
      details.publications,
      accessToken,
    );
    const offset = (page - 1) * limit;
    const publications = rows.slice(offset, offset + limit);

    return {
      paging: {
        page,
        limit,
        total: rows.length,
        totalPages: Math.ceil(rows.length / limit),
      },
      totalItems: ids.length,
      count: publications.length,
      publications,
      errors: details.errors,
    };
  }

  /** Recorre el scan completo y devuelve MLA sin duplicados. */
  async getAllPublicationIds(
    sellerId: number,
    accessToken: string,
  ): Promise<string[]> {
    const ids = new Set<string>();
    let scrollId: string | undefined;

    while (true) {
      const query = this.buildScanQuery(scrollId);
      const data = await this.apiService.get<unknown>(
        `/users/${sellerId}/items/search?${query.toString()}`,
        accessToken,
        scrollId ? 'scroll' : undefined,
      );
      const results = this.parseSearchResults(data);

      if (results.length === 0) break;
      for (const id of results) ids.add(id);

      if (!scrollId) scrollId = this.readInitialScrollId(data);
    }

    return [...ids];
  }

  /** Obtiene todos los detalles en lotes y conserva errores parciales. */
  async getPublicationDetails(
    ids: string[],
    accessToken: string,
  ): Promise<PublicationDetails> {
    const batches = chunk(ids, MULTIGET_SIZE);
    const results: PublicationDetails[] = [];

    for (
      let index = 0;
      index < batches.length;
      index += MAX_CONCURRENT_REQUESTS
    ) {
      const current = batches.slice(index, index + MAX_CONCURRENT_REQUESTS);
      results.push(
        ...(await Promise.all(
          current.map((batch) => this.fetchItemBatch(batch, accessToken)),
        )),
      );
    }

    return {
      publications: results.flatMap((result) => result.publications),
      errors: results.flatMap((result) => result.errors),
    };
  }

  /** Consulta un multiget de hasta veinte MLA. */
  async fetchItemBatch(
    ids: string[],
    accessToken: string,
  ): Promise<PublicationDetails> {
    if (ids.length === 0) return { publications: [], errors: [] };
    if (ids.length > MULTIGET_SIZE) {
      throw new BadRequestException('El multiget admite hasta 20 IDs');
    }

    try {
      const query = new URLSearchParams({ ids: ids.join(',') });
      const data = await this.apiService.get<unknown>(
        `/items?${query.toString()}`,
        accessToken,
      );

      if (!Array.isArray(data)) {
        return batchError(ids, 502, 'Respuesta multiget inválida');
      }
      return this.mapMultigetEntries(ids, data);
    } catch (error) {
      const failure = getRequestFailure(error);
      return batchError(ids, failure.code, failure.body);
    }
  }

  /** Obtiene el detalle seguro de una publicación. */
  async getPublication(itemId: string): Promise<MercadoLibrePublication> {
    this.validateItemId(itemId);
    const accessToken = await this.tokenService.getValidAccessToken();
    const data = await this.apiService.get<unknown>(
      `/items/${encodeURIComponent(itemId)}`,
      accessToken,
    );

    if (!isJsonObject(data) || data.id !== itemId) {
      throw new BadGatewayException('Respuesta de publicación inválida');
    }
    return sanitizeMercadoLibreData(data);
  }

  /** Relaciona cada entrada multiget con el MLA solicitado. */
  private mapMultigetEntries(
    ids: string[],
    data: unknown[],
  ): PublicationDetails {
    const entries = this.indexMultigetEntries(ids, data);
    const publications: MercadoLibrePublication[] = [];
    const errors: PublicationError[] = [];

    for (const id of ids) {
      const entry = entries.get(id);
      if (!entry) {
        errors.push({
          id,
          code: 502,
          body: 'Mercado Libre no devolvió el ítem solicitado',
        });
        continue;
      }

      const code = validStatus(entry.code) ? entry.code : 502;
      const body = entry.body ?? null;
      if (code === 200 && isJsonObject(body) && body.id === id) {
        publications.push(sanitizeMercadoLibreData(body));
      } else {
        errors.push({ id, code, body: sanitizeMercadoLibreData(body) });
      }
    }

    return { publications, errors };
  }

  /** Indexa las respuestas multiget por ID. */
  private indexMultigetEntries(
    ids: string[],
    data: unknown[],
  ): Map<string, MultigetEntry> {
    const entries = new Map<string, MultigetEntry>();

    data.forEach((rawEntry, index) => {
      if (!isJsonObject(rawEntry)) return;
      const body = rawEntry.body;
      const id =
        isJsonObject(body) && isNonEmptyString(body.id) ? body.id : ids[index];
      if (id && !entries.has(id)) entries.set(id, rawEntry);
    });
    return entries;
  }

  /** Crea los parámetros de una página scan. */
  private buildScanQuery(scrollId?: string): URLSearchParams {
    const query = new URLSearchParams({
      search_type: 'scan',
      limit: String(SCAN_SIZE),
    });
    if (scrollId) query.set('scroll_id', scrollId);
    return query;
  }

  /** Valida y devuelve los IDs de una página scan. */
  private parseSearchResults(data: unknown): string[] {
    if (data === null) return [];
    if (!isJsonObject(data)) {
      throw new BadGatewayException('Respuesta de publicaciones inválida');
    }
    if (data.results === null) return [];
    if (!Array.isArray(data.results)) {
      throw new BadGatewayException('IDs de publicaciones inválidos');
    }
    const results: unknown[] = data.results;
    if (results.some((id) => !isNonEmptyString(id))) {
      throw new BadGatewayException('IDs de publicaciones inválidos');
    }
    return results.filter(isNonEmptyString);
  }

  /** Obtiene el scroll_id devuelto en la primera página. */
  private readInitialScrollId(data: unknown): string {
    if (!isJsonObject(data) || !isNonEmptyString(data.scroll_id)) {
      throw new BadGatewayException('Mercado Libre no devolvió scroll_id');
    }
    return data.scroll_id;
  }

  /** Valida la paginación solicitada por el frontend. */
  private validatePaging(page: number, limit: number): void {
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser un entero mayor que cero');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
  }

  /** Valida el identificador MLA. */
  private validateItemId(itemId: string): void {
    if (!/^MLA\d+$/.test(itemId)) {
      throw new BadRequestException('itemId debe comenzar con MLA');
    }
  }
}

/** Indica si un valor es un status HTTP. */
function validStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

/** Divide una lista en grupos del tamaño indicado. */
function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/** Crea un error por cada MLA de un lote fallido. */
function batchError(
  ids: string[],
  code: number,
  body: unknown,
): PublicationDetails {
  return {
    publications: [],
    errors: ids.map((id) => ({ id, code, body })),
  };
}

/** Convierte una excepción HTTP en un error parcial seguro. */
function getRequestFailure(error: unknown): { code: number; body: unknown } {
  if (error instanceof HttpException) {
    return {
      code: error.getStatus(),
      body: sanitizeMercadoLibreData(error.getResponse()),
    };
  }
  return { code: 502, body: 'No se pudieron obtener los detalles' };
}
