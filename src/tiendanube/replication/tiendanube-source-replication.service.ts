import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { MercadoLibreReplicationSourceResolver } from './mercadolibre-replication-source-resolver';
import type { SourceReservationRepository } from './tiendanube-product-link.repository';
import { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';
import { TiendanubeProductResolver } from './tiendanube-product-resolver';
import { TiendanubeExistingProductSyncService } from './tiendanube-existing-product-sync.service';
import type { TiendanubeSourceReplicationResult } from './tiendanube-replication-result.types';
import type { TiendanubeReplicationOptions } from './tiendanube-replication.types';
import type {
  TiendanubeCreateProductDto,
  TiendanubeCreateProductVariantDto,
} from './tiendanube-replication.types';
import { withoutVariantImageSources } from './tiendanube-replication-payload';

type CreatedProduct = Readonly<{ id?: unknown }>;

@Injectable()
export class TiendanubeSourceReplicationService {
  constructor(
    private readonly mercadoLibreTokenService: MercadolibreTokenService,
    private readonly connectionRepository: TiendanubeConnectionRepository,
    private readonly linkRepository: TiendanubeProductLinkRepository,
    private readonly sourceResolver: MercadoLibreReplicationSourceResolver,
    private readonly productResolver: TiendanubeProductResolver,
    private readonly api: TiendanubeApiService,
    private readonly existingProductSync?: TiendanubeExistingProductSyncService,
  ) {}

  async replicate(
    userId: string,
    sourceKey: string,
    options?: TiendanubeReplicationOptions,
  ): Promise<TiendanubeSourceReplicationResult> {
    const mlConnection =
      await this.mercadoLibreTokenService.getStoredConnection(userId);
    const tnConnection =
      await this.connectionRepository.findOwnedCredentialsByUserId(userId);
    if (!tnConnection?.accessToken.trim())
      throw new UnauthorizedException('Primero conectá Tiendanube');
    if (options) {
      const category = await this.api.get<unknown>(
        tnConnection.storeId,
        `/categories/${options.categoryId}`,
        tnConnection.accessToken,
      );
      if (!category || typeof category !== 'object')
        throw new ConflictException('La categoría de Tiendanube no existe');
    }
    const token = await this.mercadoLibreTokenService.getValidAccessToken(
      userId,
      mlConnection,
    );
    const source = await this.sourceResolver.resolve(
      sourceKey,
      mlConnection.seller_id,
      token,
    );
    const payload = options
      ? applyReplicationOptions(source.product, options)
      : source.product;
    const links = this.linkRepository as unknown as SourceReservationRepository;
    const context = {
      userId: tnConnection.userId,
      storeId: tnConnection.storeId,
      sourceKey,
    };
    const reservation = await links.reserveBySource(context);
    if (reservation.outcome === 'PENDING')
      throw new ConflictException('La replicación está pendiente');
    let productId =
      reservation.outcome === 'COMPLETED'
        ? reservation.tiendanubeProductId
        : null;
    if (
      productId &&
      !(await this.productResolver.exists(tnConnection, productId))
    )
      productId = null;
    if (!productId)
      productId = await this.productResolver.resolve(tnConnection, source.skus);

    if (productId) {
      if (this.existingProductSync) {
        await this.existingProductSync.sync(tnConnection, productId, payload);
      } else {
        await this.api.put(
          tnConnection.storeId,
          `/products/${encodeURIComponent(productId)}`,
          withoutVariantImageSources(payload),
          tnConnection.accessToken,
        );
      }
      if (reservation.outcome === 'RESERVED') {
        await links.completeBySource({
          ...context,
          linkId: reservation.linkId,
          reservationVersion: reservation.reservationVersion,
          tiendanubeProductId: productId,
        });
      }
      return {
        ok: true,
        action: 'updated',
        sourceKey,
        tiendanubeProductId: productId,
      };
    }

    let created: CreatedProduct | undefined;
    try {
      created = await this.api.post<CreatedProduct>(
        tnConnection.storeId,
        '/products',
        withoutVariantImageSources(payload),
        tnConnection.accessToken,
      );
    } catch (error) {
      if (reservation.outcome === 'RESERVED') {
        await links.failBySource({
          ...context,
          linkId: reservation.linkId,
          reservationVersion: reservation.reservationVersion,
        });
      }
      throw error;
    }
    const createdId = parseProductId(created);
    if (this.existingProductSync) {
      await this.existingProductSync.sync(tnConnection, createdId, payload);
    }
    if (reservation.outcome === 'RESERVED') {
      await links.completeBySource({
        ...context,
        linkId: reservation.linkId,
        reservationVersion: reservation.reservationVersion,
        tiendanubeProductId: createdId,
      });
    }
    return {
      ok: true,
      action: 'created',
      sourceKey,
      tiendanubeProductId: createdId,
    };
  }
}

function applyReplicationOptions(
  product: TiendanubeCreateProductDto,
  options: TiendanubeReplicationOptions,
): TiendanubeCreateProductDto {
  const price = resolveOverridePrice(options);
  const promotionalPrice = resolvePromotionalPrice(options);

  return {
    ...product,
    ...(options.title !== undefined
      ? { name: { es: requireTitle(options.title) } }
      : {}),
    categories: [options.categoryId],
    variants: product.variants.map((variant) =>
      applyVariantPrices(variant, price, promotionalPrice),
    ),
    ...(options.tagMode === 'OVERRIDE'
      ? { tags: normalizeTags(options.tags) }
      : {}),
  };
}

function resolveOverridePrice(
  options: TiendanubeReplicationOptions,
): number | undefined {
  if (options.priceMode !== 'OVERRIDE') {
    return undefined;
  }

  if (
    options.price === undefined ||
    !Number.isFinite(options.price) ||
    options.price <= 0
  ) {
    throw new BadRequestException('El precio normal debe ser mayor a cero');
  }

  return options.price;
}

function resolvePromotionalPrice(
  options: TiendanubeReplicationOptions,
): number | undefined {
  if (options.promotionalPrice === undefined) {
    return undefined;
  }

  if (
    !Number.isFinite(options.promotionalPrice) ||
    options.promotionalPrice <= 0
  ) {
    throw new BadRequestException('El precio promocional debe ser mayor a cero');
  }

  return options.promotionalPrice;
}

function applyVariantPrices(
  variant: TiendanubeCreateProductVariantDto,
  overridePrice: number | undefined,
  promotionalPrice: number | undefined,
): TiendanubeCreateProductVariantDto {
  const price = overridePrice ?? parseNormalPrice(variant.price);

  if (promotionalPrice !== undefined && promotionalPrice >= price) {
    throw new BadRequestException(
      'El precio promocional debe ser menor al precio normal',
    );
  }

  return {
    ...variant,
    ...(overridePrice !== undefined ? { price: overridePrice.toFixed(2) } : {}),
    ...(promotionalPrice !== undefined
      ? { promotional_price: promotionalPrice.toFixed(2) }
      : {}),
  };
}

function parseNormalPrice(value: string): number {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) {
    throw new BadRequestException('El precio normal debe ser mayor a cero');
  }

  return price;
}

function requireTitle(value: string): string {
  const title = value.trim();
  if (!title) {
    throw new BadRequestException('El tÃ­tulo no puede estar vacÃ­o');
  }

  return title;
}

function normalizeTags(tags: readonly string[] | undefined): string {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags ?? []) {
    const trimmed = tag.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized.join(',');
}

function parseProductId(value: CreatedProduct | undefined): string {
  if (!value)
    throw new ConflictException('Tiendanube devolvió un producto inválido');
  if (
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id > 0
  )
    return String(value.id);
  if (typeof value.id === 'string' && /^[1-9]\d*$/u.test(value.id))
    return value.id;
  throw new ConflictException('Tiendanube devolvió un producto inválido');
}
