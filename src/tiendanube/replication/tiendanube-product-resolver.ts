import { ConflictException, HttpException, Injectable } from '@nestjs/common';

import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import type { TiendanubeConnectionCredentials } from '../connections/tiendanube-connection.repository';

@Injectable()
export class TiendanubeProductResolver {
  constructor(private readonly api: TiendanubeApiService) {}

  async resolve(
    connection: TiendanubeConnectionCredentials,
    skus: readonly string[],
  ): Promise<string | null> {
    const uniqueSkus = [...new Set(skus.filter((sku) => sku.trim()))];
    const products = await Promise.all(
      uniqueSkus.map((sku) => this.bySku(connection, sku)),
    );
    const ids = new Set(
      products.flatMap((product) => (product ? [product] : [])),
    );
    if (ids.size > 1) {
      throw new ConflictException(
        'Los SKU apuntan a productos Tiendanube diferentes',
      );
    }
    return [...ids][0] ?? null;
  }

  async exists(
    connection: TiendanubeConnectionCredentials,
    productId: string,
  ): Promise<boolean> {
    try {
      const product = await this.api.get<unknown>(
        connection.storeId,
        `/products/${encodeURIComponent(productId)}`,
        connection.accessToken,
      );
      return Boolean(product && typeof product === 'object');
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  private async bySku(
    connection: TiendanubeConnectionCredentials,
    sku: string,
  ): Promise<string | null> {
    try {
      const product = await this.api.get<unknown>(
        connection.storeId,
        `/products/sku/${encodeURIComponent(sku)}`,
        connection.accessToken,
      );
      if (!product || typeof product !== 'object' || !('id' in product))
        return null;
      const id = (product as { id?: unknown }).id;
      return typeof id === 'string' || typeof id === 'number'
        ? String(id)
        : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 404;
}
