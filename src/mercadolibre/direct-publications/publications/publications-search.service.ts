import { Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import {
  MlScanResponse,
  MlSearchResponse,
} from './publications-search.types';

@Injectable()
export class PublicationsSearchService {
  constructor(
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Busca publicaciones con limit/offset. */
  searchPage(
    sellerId: string | number,
    accessToken: string,
    limit: number,
    offset: number,
  ): Promise<MlSearchResponse> {
    return this.apiService.get<MlSearchResponse>(
      `/users/${sellerId}/items/search?limit=${limit}&offset=${offset}`,
      accessToken,
    );
  }

  /** Recorre publicaciones con scan/scroll_id. */
  scanPage(
    sellerId: string | number,
    accessToken: string,
    limit: number,
    cursor?: string,
  ): Promise<MlScanResponse> {
const path = cursor
  ? `/users/${sellerId}/items/search?search_type=scan&scroll_id=${encodeURIComponent(cursor)}&limit=${limit}`
  : `/users/${sellerId}/items/search?search_type=scan&limit=${limit}`;

    return this.apiService.get<MlScanResponse>(
      path,
      accessToken,
    );
  }

  /** Busca MLA asociados a uno o varios MLAU. */
  async searchByUserProductIds(
    sellerId: string | number,
    userProductIds: string[],
    accessToken: string,
  ): Promise<string[]> {
    const itemIds = new Set<string>();

    for (let i = 0; i < userProductIds.length; i += 20) {
      const batch = userProductIds.slice(i, i + 20);

      await this.searchUserProductBatch(
        sellerId,
        batch,
        accessToken,
        itemIds,
      );
    }

    return [...itemIds];
  }

  private async searchUserProductBatch(
    sellerId: string | number,
    userProductIds: string[],
    accessToken: string,
    itemIds: Set<string>,
  ): Promise<void> {
    let offset = 0;

    while (true) {
      const response =
        await this.apiService.get<MlSearchResponse>(
          `/users/${sellerId}/items/search` +
            `?user_product_id=${userProductIds.join(',')}` +
            `&limit=100&offset=${offset}`,
          accessToken,
        );

      response.results.forEach((itemId) =>
        itemIds.add(itemId),
      );

      offset += response.paging.limit;

      if (offset >= response.paging.total) {
        break;
      }
    }
  }
}