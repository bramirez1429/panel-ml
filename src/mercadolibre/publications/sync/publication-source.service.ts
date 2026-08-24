import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  MercadolibreApiService,
  sanitizeMercadoLibreData,
} from '../../shared/mercadolibre-api.service';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';
import {
  MERCADOLIBRE_REQUEST_CONCURRENCY,
  PUBLICATION_MULTIGET_SIZE,
  PUBLICATION_SCAN_SIZE,
  PUBLICATION_SYNC_ATTRIBUTES,
  USER_PRODUCT_FILTER_BATCH_SIZE,
  USER_PRODUCT_ITEM_SEARCH_SIZE,
} from '../publication.constants';
import {
  MercadoLibrePublication,
  PublicationSourceResult,
} from '../publication.types';
import { PublicationScanPage } from './publication-sync.types';
import {
  chunk,
  parseMultiget,
  parseScrollId,
  parseSearchIds,
  parseSearchTotal,
} from './publication-source.helpers';

@Injectable()
export class PublicationSourceService {
  /** Prepara el acceso compartido a Mercado Libre. */
  constructor(private readonly apiService: MercadolibreApiService) {}

  /** Obtiene una sola página del scan de Mercado Libre. */
  async fetchNextScanPage(
    sellerId: number,
    accessToken: string,
    scrollId?: string,
  ): Promise<PublicationScanPage> {
    const query = new URLSearchParams({
      search_type: 'scan',
      limit: String(PUBLICATION_SCAN_SIZE),
    });
    if (scrollId) query.set('scroll_id', scrollId);

    const data = await this.apiService.get<unknown>(
      `/users/${sellerId}/items/search?${query.toString()}`,
      accessToken,
      scrollId ? 'scroll' : undefined,
    );
    const itemIds = [...new Set(parseSearchIds(data))];
    return {
      itemIds,
      scrollId: itemIds.length > 0 ? parseScrollId(data) : null,
    };
  }

  /** Recorre el scan y devuelve todos los MLA sin duplicados. */
  async getAllItemIds(
    sellerId: number,
    accessToken: string,
  ): Promise<string[]> {
    const ids = new Set<string>();
    let scrollId: string | undefined;

    while (true) {
      const query = new URLSearchParams({
        search_type: 'scan',
        limit: String(PUBLICATION_SCAN_SIZE),
      });
      if (scrollId) query.set('scroll_id', scrollId);

      const data = await this.apiService.get<unknown>(
        `/users/${sellerId}/items/search?${query.toString()}`,
        accessToken,
        scrollId ? 'scroll' : undefined,
      );
      const pageIds = parseSearchIds(data);
      if (pageIds.length === 0) break;
      for (const id of pageIds) ids.add(id);
      if (!scrollId) scrollId = parseScrollId(data);
    }
    return [...ids];
  }

  /** Obtiene detalles en multiget con cuatro lotes simultáneos. */
  async getPublicationDetails(
    itemIds: string[],
    accessToken: string,
  ): Promise<PublicationSourceResult> {
    const batches = chunk([...new Set(itemIds)], PUBLICATION_MULTIGET_SIZE);
    const results: PublicationSourceResult[] = [];

    for (
      let index = 0;
      index < batches.length;
      index += MERCADOLIBRE_REQUEST_CONCURRENCY
    ) {
      const current = batches.slice(
        index,
        index + MERCADOLIBRE_REQUEST_CONCURRENCY,
      );
      results.push(
        ...(await Promise.all(
          current.map((ids) => this.fetchItemBatch(ids, accessToken)),
        )),
      );
    }
    return {
      publications: results.flatMap((result) => result.publications),
      errors: results.flatMap((result) => result.errors),
    };
  }

  /** Consulta un multiget oficial de hasta veinte publicaciones. */
  async fetchItemBatch(
    itemIds: string[],
    accessToken: string,
  ): Promise<PublicationSourceResult> {
    if (itemIds.length === 0) return { publications: [], errors: [] };
    if (itemIds.length > PUBLICATION_MULTIGET_SIZE) {
      throw new BadRequestException('El multiget admite hasta 20 IDs');
    }

    const query = new URLSearchParams({
      ids: itemIds.join(','),
      attributes: PUBLICATION_SYNC_ATTRIBUTES.join(','),
    });
    const data = await this.apiService.get<unknown>(
      `/items?${query.toString()}`,
      accessToken,
    );
    return parseMultiget(itemIds, data);
  }

  /** Obtiene y valida una publicación individual. */
  async getItem(
    itemId: string,
    accessToken: string,
  ): Promise<MercadoLibrePublication> {
    return this.getValidatedItem(itemId, accessToken, false);
  }

  /** Obtiene un MLA con todos sus atributos, incluidos los usados para SKU. */
  async getItemWithAllAttributes(
    itemId: string,
    accessToken: string,
  ): Promise<MercadoLibrePublication> {
    return this.getValidatedItem(itemId, accessToken, true);
  }

  /** Comparte validación y saneamiento entre las lecturas individuales. */
  private async getValidatedItem(
    itemId: string,
    accessToken: string,
    includeAllAttributes: boolean,
  ): Promise<MercadoLibrePublication> {
    if (!/^MLA\d+$/.test(itemId)) {
      throw new BadRequestException('itemId debe comenzar con MLA');
    }
    const suffix = includeAllAttributes ? '?include_attributes=all' : '';
    const data = await this.apiService.get<unknown>(
      `/items/${encodeURIComponent(itemId)}${suffix}`,
      accessToken,
    );
    if (!isJsonObject(data) || data.id !== itemId) {
      throw new BadGatewayException('Respuesta de publicación inválida');
    }
    return sanitizeMercadoLibreData(data);
  }

  /** Busca todos los MLA asociados a uno o más User Products. */
  async getItemIdsForUserProducts(
    sellerId: number,
    userProductIds: string[],
    accessToken: string,
  ): Promise<string[]> {
    const ids = normalizeUserProductIds(userProductIds);
    if (ids.length === 0) return [];

    const batches = chunk(ids, USER_PRODUCT_FILTER_BATCH_SIZE);
    const itemIds = new Set<string>();
    for (
      let index = 0;
      index < batches.length;
      index += MERCADOLIBRE_REQUEST_CONCURRENCY
    ) {
      const current = batches.slice(
        index,
        index + MERCADOLIBRE_REQUEST_CONCURRENCY,
      );
      const results = await Promise.all(
        current.map((batch) =>
          this.searchItemsByUserProducts(sellerId, batch, accessToken),
        ),
      );
      for (const itemId of results.flat()) itemIds.add(itemId);
    }
    return [...itemIds];
  }

  /** Pagina la b\u00fasqueda de MLA para un grupo acotado de MLAU. */
  private async searchItemsByUserProducts(
    sellerId: number,
    userProductIds: string[],
    accessToken: string,
  ): Promise<string[]> {
    const itemIds = new Set<string>();
    let offset = 0;
    while (true) {
      const query = new URLSearchParams({
        user_product_id: userProductIds.join(','),
        limit: String(USER_PRODUCT_ITEM_SEARCH_SIZE),
        offset: String(offset),
      });
      const data = await this.apiService.get<unknown>(
        `/users/${sellerId}/items/search?${query.toString()}`,
        accessToken,
      );
      const pageIds = parseSearchIds(data);
      const total = parseSearchTotal(data);
      for (const id of pageIds) itemIds.add(id);

      offset += pageIds.length;
      if (pageIds.length === 0 || offset >= total) break;
    }
    return [...itemIds];
  }
}

/** Valida y elimina MLAU repetidos. */
function normalizeUserProductIds(values: string[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        const id = value.trim();
        return /^MLAU\d+$/.test(id) && isNonEmptyString(id) ? [id] : [];
      }),
    ),
  ];
}
