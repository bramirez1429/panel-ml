import { Injectable } from '@nestjs/common';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import type { GroupedProductListRow } from '../../../database/repositories/mercadolibre-publications.types';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { GroupedProduct } from './publication.types';
import { normalizeTitleSearch } from './publication-title-search.helpers';
import { PublicationsReadSource } from './publications-read-source';
import {
  decodeSupabasePublicationsCursor,
  encodeSupabasePublicationsCursor,
} from './supabase-publications-cursor';

@Injectable()
export class SupabasePublicationsReadSource extends PublicationsReadSource {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly productsRepository: MercadolibreProductsRepository,
  ) {
    super();
  }

  async getGrouped(
    userId: string,
    limit: number,
    cursor?: string,
    search?: string,
  ) {
    const offset = decodeSupabasePublicationsCursor(cursor);
    const connection = await this.tokenService.getStoredConnection(userId);
    const tokens = normalizeTitleSearch(search).split(' ').filter(Boolean);
    const page = await this.productsRepository.findGroupedPage(
      connection.seller_id,
      offset,
      limit,
      tokens,
    );
    const products = page.products.map(mapProduct);
    const nextOffset = offset + products.length;
    const done = products.length < limit || nextOffset >= page.total;

    return {
      done,
      nextCursor: done ? null : encodeSupabasePublicationsCursor(nextOffset),
      rawItemsCount: page.products.reduce(
        (total, product) =>
          total + (product.model === 'SHARED' ? 1 : product.children_count),
        0,
      ),
      productsCount: products.length,
      products,
    };
  }
}

function mapProduct(product: GroupedProductListRow): GroupedProduct {
  if (product.model === 'SHARED') {
    return {
      key: product.external_key,
      model: 'SHARED',
      itemId:
        product.parent_item_id ?? product.external_key.replace('item:', ''),
      title: product.title,
      price: product.price_from,
      stock: product.stock_total,
      sold: product.sold_total,
      status: product.status,
      thumbnail: product.thumbnail,
      permalink: product.permalink,
      currency: product.currency_id,
      variantsCount: Array.isArray(product.shared_variations)
        ? product.shared_variations.length
        : 0,
    };
  }

  return {
    key: product.external_key,
    model: 'VARIANT_PRICING',
    familyId: product.family_id ?? '',
    familyName: product.family_name,
    variantsCount: product.children_count,
    itemsCount: product.children_count,
    itemId: null,
    userProductId: null,
    title: product.title,
    priceFrom: product.price_from,
    priceTo: product.price_to,
    currency: product.currency_id,
    stock: product.stock_total,
    sold: product.sold_total,
    status: product.status,
    thumbnail: product.thumbnail,
    permalink: product.permalink,
  };
}
