import { BadGatewayException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { TiendanubeConnectionRepository } from '../tiendanube/connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../tiendanube/shared/tiendanube-api.service';
import type { ChannelVariant } from './sales.types';
import {
  attributeKind,
  isObject,
  localizedText,
  nonNegativeStock,
  text,
  sameSku,
} from './variant-normalization';

@Injectable()
export class TiendanubeCurveService {
  constructor(
    private readonly connections: TiendanubeConnectionRepository,
    private readonly api: TiendanubeApiService,
  ) {}


  /** Tiendanube filtra productos por nombre, etiquetas o SKU; validamos cada variante. */
  async findBySku(userId: string, sku: string): Promise<Array<{
    productId: string;
    variantId: string;
    name: string;
    color: string | null;
    size: string | null;
    sku: string;
    stock: number | null;
    status: string;
  }>> {
    const connection = await this.connections.findCredentialsByUserId(userId);
    if (!connection) {
      throw new UnauthorizedException('Primero conectá Tiendanube');
    }
    const matches: Array<{
      productId: string; variantId: string; name: string;
      color: string | null; size: string | null; sku: string;
      stock: number | null; status: string;
    }> = [];

    for (let page = 1; page <= 10; page += 1) {
      const query = new URLSearchParams({
        q: sku, page: String(page), per_page: '200',
      });
      const products = await this.api.get<unknown>(
        connection.storeId,
        `/products?${query.toString()}`,
        connection.accessToken,
      );
      if (!Array.isArray(products)) {
        throw new BadGatewayException('Tiendanube devolvió una búsqueda SKU inválida');
      }
      for (const product of products) {
        if (!isObject(product)) {
          throw new BadGatewayException('Tiendanube devolvió un producto inválido');
        }
        const productId = text(product.id);
        const name = localizedText(product.name) ?? (productId ? `Producto ${productId}` : 'Producto');
        const status = text(product.visibility) ?? 'sin dato';
        for (const variant of mapTiendanubeProduct(product, productId ?? undefined)) {
          if (!variant.tiendaNube || !sameSku(variant.sku, sku)) continue;
          matches.push({
            productId: variant.tiendaNube.productId,
            variantId: variant.tiendaNube.variantId,
            name,
            color: variant.color,
            size: variant.size,
            sku: variant.sku!.trim(),
            stock: variant.tiendaNube.stock,
            status,
          });
        }
      }
      if (products.length < 200) return matches;
    }
    throw new ServiceUnavailableException(
      'Demasiados productos para este SKU; no se puede comprobar la unicidad',
    );
  }

  async getForUser(
    userId: string,
    productId: string,
  ): Promise<ChannelVariant[]> {
    const connection = await this.connections.findCredentialsByUserId(userId);
    if (!connection) {
      throw new UnauthorizedException('Primero conectá Tiendanube');
    }
    const product = await this.api.get<unknown>(
      connection.storeId,
      `/products/${encodeURIComponent(productId)}`,
      connection.accessToken,
    );
    return mapTiendanubeProduct(product, productId);
  }
}

export function mapTiendanubeProduct(
  value: unknown,
  expectedProductId?: string,
): ChannelVariant[] {
  if (!isObject(value)) return [];
  const productId = text(value.id);
  if (!productId || (expectedProductId && productId !== expectedProductId)) {
    return [];
  }
  const attributes = Array.isArray(value.attributes)
    ? value.attributes.map(localizedText)
    : [];
  const variants = Array.isArray(value.variants) ? value.variants : [];

  return variants.filter(isObject).flatMap((variant) => {
    const variantId = text(variant.id);
    if (!variantId) return [];
    const values = Array.isArray(variant.values)
      ? variant.values.map(localizedText)
      : [];
    let color: string | null = null;
    let size: string | null = null;
    attributes.forEach((name, index) => {
      const kind = attributeKind(null, name);
      if (kind === 'color') color = values[index] ?? null;
      if (kind === 'size') size = values[index] ?? null;
    });
    return [
      {
        sku: text(variant.sku),
        color,
        size,
        ml: null,
        tiendaNube: {
          productId,
          variantId,
          stock: nonNegativeStock(variant.stock),
        },
      },
    ];
  });
}
