import {
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
      await this.connectionRepository.findCredentialsByUserId(userId);
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
      ? {
          ...source.product,
          categories: [options.categoryId],
          variants:
            options.priceMode === 'OVERRIDE' && options.price !== undefined
              ? source.product.variants.map((variant) => ({
                  ...variant,
                  price: options.price!.toFixed(2),
                }))
              : source.product.variants,
          ...(options.tagMode === 'OVERRIDE'
            ? { tags: normalizeTags(options.tags) }
            : {}),
        }
      : source.product;
    const links = this.linkRepository as unknown as SourceReservationRepository;
    const context = { userId, storeId: tnConnection.storeId, sourceKey };
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
