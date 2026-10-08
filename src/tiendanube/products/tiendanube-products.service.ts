import { Injectable, UnauthorizedException } from '@nestjs/common';

import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeProductMapper } from './tiendanube-product.mapper';
import type {
  TiendanubeProductResponse,
  TiendanubeProductsCatalogQuery,
  TiendanubeProductsCatalogResponse,
} from './tiendanube-product.types';

@Injectable()
export class TiendanubeProductsService {
  constructor(
    private readonly connectionRepository: TiendanubeConnectionRepository,
    private readonly apiService: TiendanubeApiService,
  ) {}

  async listByUserId(
    userId: string,
  ): Promise<readonly TiendanubeProductResponse[]> {
    const connection =
      await this.connectionRepository.findCredentialsByUserId(userId);

    if (!connection || !connection.accessToken.trim()) {
      throw new UnauthorizedException(
        'Primero conectá Tiendanube desde /tiendanube/connect',
      );
    }

    const response = await this.apiService.get<unknown>(
      connection.storeId,
      '/products',
      connection.accessToken,
    );

    return TiendanubeProductMapper.mapList(response);
  }

  async listCatalogByUserId(
    userId: string,
    query: TiendanubeProductsCatalogQuery,
  ): Promise<TiendanubeProductsCatalogResponse> {
    const connection =
      await this.connectionRepository.findCredentialsByUserId(userId);

    if (!connection || !connection.accessToken.trim()) {
      throw new UnauthorizedException(
        'Primero conectÃ¡ Tiendanube desde /tiendanube/connect',
      );
    }

    const response = await this.apiService.getWithMeta<unknown>(
      connection.storeId,
      buildCatalogPath(query),
      connection.accessToken,
    );
    const products = TiendanubeProductMapper.mapCatalogList(response.data);
    const total = parseTotal(response.headers.get('x-total-count'));

    return {
      products,
      page: query.page,
      hasMore:
        total === undefined
          ? products.length === query.limit
          : query.page * query.limit < total,
      ...(total === undefined ? {} : { total }),
    };
  }
}

function buildCatalogPath(query: TiendanubeProductsCatalogQuery): string {
  const parameters = new URLSearchParams({
    page: String(query.page),
    per_page: String(query.limit),
  });
  const search = query.q?.trim();
  if (search) parameters.set('q', search);

  return `/products?${parameters.toString()}`;
}

function parseTotal(value: string | null): number | undefined {
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  const total = Number(value);
  return Number.isSafeInteger(total) ? total : undefined;
}
