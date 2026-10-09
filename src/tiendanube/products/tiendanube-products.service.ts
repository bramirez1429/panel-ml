import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { VariantChannelLinksRepository } from '../../sales/variant-channel-links.repository';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeProductMapper } from './tiendanube-product.mapper';
import type {
  TiendanubeProductsCatalogQuery,
  TiendanubeProductsCatalogResponse,
  TiendanubeProductByMercadolibreResponse,
  TiendanubeProductResponse,
} from './tiendanube-product.types';

const UNLINKED_PRODUCT: TiendanubeProductByMercadolibreResponse = {
  linked: false,
  price: null,
  promotionalPrice: null,
  stock: null,
  sku: null,
};

@Injectable()
export class TiendanubeProductsService {
  constructor(
    private readonly connectionRepository: TiendanubeConnectionRepository,
    private readonly apiService: TiendanubeApiService,
    private readonly variantLinks: VariantChannelLinksRepository,
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

  async getByMercadolibreItem(
    userId: string,
    itemId: unknown,
    mlVariationId?: unknown,
  ): Promise<TiendanubeProductByMercadolibreResponse> {
    const normalizedItemId = parseMlItemId(itemId);
    const normalizedVariationId = parseMlVariationId(mlVariationId);
    const links = await this.variantLinks.findByUserIdAndMlItemId(
      userId,
      normalizedItemId,
      normalizedVariationId,
    );

    if (links.length === 0) {
      return UNLINKED_PRODUCT;
    }

    if (links.length > 1) {
      throw new ConflictException(
        'La publicaciÃ³n tiene mÃ¡s de una variante vinculada; indique mlVariationId',
      );
    }

    const connection =
      await this.connectionRepository.findCredentialsByUserId(userId);

    if (!connection || !connection.accessToken.trim()) {
      throw new UnauthorizedException(
        'Primero conectÃ¡ Tiendanube desde /tiendanube/connect',
      );
    }

    const link = links[0];
    const response = await this.apiService.get<unknown>(
      connection.storeId,
      `/products/${encodeURIComponent(link.tnProductId)}/variants/${encodeURIComponent(link.tnVariantId)}`,
      connection.accessToken,
    );

    return mapLinkedVariant(response);
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

function parseMlItemId(value: unknown): string {
  if (typeof value !== 'string' || !/^MLA\d+$/u.test(value)) {
    throw new BadRequestException('itemId de Mercado Libre invÃ¡lido');
  }

  return value;
}

function parseMlVariationId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new BadRequestException('mlVariationId de Mercado Libre invÃ¡lido');
  }

  return value;
}

function mapLinkedVariant(
  value: unknown,
): TiendanubeProductByMercadolibreResponse {
  if (!isRecord(value)) {
    throw new BadGatewayException('Tiendanube no devolviÃ³ una variante vÃ¡lida');
  }

  return {
    linked: true,
    price: parseNumber(value.price),
    promotionalPrice: parseNumber(value.promotional_price),
    stock: parseNumber(value.stock),
    sku: parseSku(value.sku),
  };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseSku(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const sku = value.trim();
  return sku || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
