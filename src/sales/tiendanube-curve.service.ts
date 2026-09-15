import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TiendanubeConnectionRepository } from '../tiendanube/connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../tiendanube/shared/tiendanube-api.service';
import type { ChannelVariant } from './sales.types';
import {
  attributeKind,
  isObject,
  localizedText,
  nonNegativeStock,
  text,
} from './variant-normalization';

@Injectable()
export class TiendanubeCurveService {
  constructor(
    private readonly connections: TiendanubeConnectionRepository,
    private readonly api: TiendanubeApiService,
  ) {}

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
