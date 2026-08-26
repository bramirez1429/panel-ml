import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';

import { MercadolibreProductsRepository } from '../../database/repositories/mercadolibre-products.repository';
import { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { MercadoLibreReplicationSourceService } from './mercadolibre-replication-source.service';
import { MercadoLibreToTiendanubeMapper } from './mercadolibre-to-tiendanube.mapper';
import { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';
import type { SourceLinkRepository } from './tiendanube-product-link.repository';
import { MercadoLibreReplicationSourceResolver } from './mercadolibre-replication-source-resolver';
import { TiendanubeProductResolver } from './tiendanube-product-resolver';
import { TiendanubeSourceReplicationService } from './tiendanube-source-replication.service';
import type { TiendanubeReplicationResult } from './tiendanube-replication-result.types';
import type { TiendanubeReplicationUpsertResult } from './tiendanube-replication-result.types';
import type { TiendanubeSourceReplicationResult } from './tiendanube-replication-result.types';
import { isTiendanubeSourceKey } from './tiendanube-replication-source.dto';
import type { TiendanubeReplicationOptions } from './tiendanube-replication.types';

type TiendanubeCreatedProduct = Readonly<{ id?: unknown }>;

@Injectable()
export class TiendanubeReplicationService {
  constructor(
    private readonly mercadoLibreTokenService: MercadolibreTokenService,
    private readonly mercadoLibreProductsRepository: MercadolibreProductsRepository,
    private readonly tiendanubeConnectionRepository: TiendanubeConnectionRepository,
    private readonly productLinkRepository: TiendanubeProductLinkRepository,
    private readonly sourceService: MercadoLibreReplicationSourceService,
    private readonly tiendanubeApiService: TiendanubeApiService,
    @Optional()
    private readonly directSourceResolver?: MercadoLibreReplicationSourceResolver,
    @Optional()
    private readonly tiendanubeProductResolver?: TiendanubeProductResolver,
    @Optional()
    private readonly directReplicationService?: TiendanubeSourceReplicationService,
  ) {}

  async replicateBySourceKey(
    userId: string,
    sourceKey: string,
  ): Promise<TiendanubeSourceReplicationResult> {
    return this.replicateOrUpdateBySourceKey(userId, sourceKey);
  }

  async replicateOrUpdateBySourceKey(
    userId: string,
    sourceKey: string,
    options?: TiendanubeReplicationOptions,
  ): Promise<TiendanubeSourceReplicationResult> {
    if (!isTiendanubeSourceKey(sourceKey)) {
      throw new BadRequestException('sourceKey de Mercado Libre inválido');
    }
    if (this.directReplicationService) {
      return this.directReplicationService.replicate(
        userId,
        sourceKey,
        options,
      );
    }
    if (this.directSourceResolver) {
      return this.replicateDirectSource(userId, sourceKey, options);
    }
    const connection =
      await this.mercadoLibreTokenService.getStoredConnection(userId);
    const product = await this.mercadoLibreProductsRepository.findByExternalKey(
      connection.seller_id,
      sourceKey,
    );
    if (!product) {
      throw new NotFoundException(
        'La publicación de Mercado Libre no existe para el usuario autenticado',
      );
    }
    const result = await this.replicateOrUpdateBySourceId(userId, product.id);
    return {
      ok: true,
      action: result.action,
      sourceKey,
      tiendanubeProductId: result.tiendanubeProductId,
    };
  }

  private async replicateDirectSource(
    userId: string,
    sourceKey: string,
    options?: TiendanubeReplicationOptions,
  ): Promise<TiendanubeSourceReplicationResult> {
    const mercadoLibreConnection =
      await this.mercadoLibreTokenService.getStoredConnection(userId);
    const tiendanubeConnection =
      await this.tiendanubeConnectionRepository.findCredentialsByUserId(userId);
    if (!tiendanubeConnection?.accessToken.trim()) {
      throw new UnauthorizedException('Primero conectá Tiendanube');
    }
    this.requireProductWriteScope(tiendanubeConnection.scope);
    if (options)
      await this.ensureCategory(
        tiendanubeConnection.storeId,
        tiendanubeConnection.accessToken,
        options.categoryId,
      );
    const mercadoLibreAccessToken =
      await this.mercadoLibreTokenService.getValidAccessToken(
        userId,
        mercadoLibreConnection,
      );
    const source = await this.directSourceResolver!.resolve(
      sourceKey,
      mercadoLibreConnection.seller_id,
      mercadoLibreAccessToken,
    );
    const payload = applyOptions(source.product, options);
    const links = this.productLinkRepository as unknown as SourceLinkRepository;
    const link = await links.findBySourceKey({
      userId,
      storeId: tiendanubeConnection.storeId,
      sourceKey,
    });
    let productId = link?.tiendanubeProductId ?? null;
    if (link?.status === 'PENDING') {
      throw new ConflictException(
        'La replicación de esta publicación está pendiente',
      );
    }
    if (!this.tiendanubeProductResolver) {
      throw new UnauthorizedException(
        'El resolver de productos Tiendanube no está configurado',
      );
    }
    if (
      productId &&
      !(await this.tiendanubeProductResolver.exists(
        tiendanubeConnection,
        productId,
      ))
    ) {
      productId = null;
    }
    if (!productId) {
      productId = await this.tiendanubeProductResolver.resolve(
        tiendanubeConnection,
        source.skus,
      );
    }
    if (productId) {
      await this.tiendanubeApiService.put(
        tiendanubeConnection.storeId,
        `/products/${encodeURIComponent(productId)}`,
        payload,
        tiendanubeConnection.accessToken,
      );
      await links.saveSourceLink({
        userId,
        storeId: tiendanubeConnection.storeId,
        sourceKey,
        tiendanubeProductId: productId,
      });
      return {
        ok: true,
        action: 'updated',
        sourceKey,
        tiendanubeProductId: productId,
      };
    }
    const created =
      await this.tiendanubeApiService.post<TiendanubeCreatedProduct>(
        tiendanubeConnection.storeId,
        '/products',
        payload,
        tiendanubeConnection.accessToken,
      );
    const createdId = parseCreatedProductId(created);
    await links.saveSourceLink({
      userId,
      storeId: tiendanubeConnection.storeId,
      sourceKey,
      tiendanubeProductId: createdId,
    });
    return {
      ok: true,
      action: 'created',
      sourceKey,
      tiendanubeProductId: createdId,
    };
  }

  async replicateOrUpdateBySourceId(
    userId: string,
    sourceId: string,
  ): Promise<TiendanubeReplicationUpsertResult> {
    const mercadoLibreConnection =
      await this.mercadoLibreTokenService.getStoredConnection(userId);
    const tiendanubeConnection =
      await this.tiendanubeConnectionRepository.findCredentialsByUserId(userId);

    if (!tiendanubeConnection?.accessToken.trim()) {
      throw new UnauthorizedException(
        'Primero conectÃ¡ Tiendanube desde /tiendanube/connect',
      );
    }
    this.requireProductWriteScope(tiendanubeConnection.scope);

    const mercadoLibreProduct =
      await this.mercadoLibreProductsRepository.findById(
        mercadoLibreConnection.seller_id,
        sourceId,
      );
    if (!mercadoLibreProduct) {
      throw new NotFoundException(
        'La publicaciÃ³n de Mercado Libre no existe para el usuario autenticado',
      );
    }

    const linkContext = {
      userId,
      storeId: tiendanubeConnection.storeId,
      mlProductId: mercadoLibreProduct.id,
      mlSourceKey: mercadoLibreProduct.external_key,
    } as const;
    const reservation = await this.productLinkRepository.reserve(linkContext);

    if (reservation.outcome === 'PENDING') {
      throw new ConflictException(
        'La replicaciÃ³n de esta publicaciÃ³n ya estÃ¡ pendiente',
      );
    }

    let payload: ReturnType<typeof MercadoLibreToTiendanubeMapper.map>;
    try {
      const mercadoLibreAccessToken =
        await this.mercadoLibreTokenService.getValidAccessToken(
          userId,
          mercadoLibreConnection,
        );
      const source = await this.sourceService.load(
        mercadoLibreProduct,
        mercadoLibreConnection.seller_id,
        mercadoLibreAccessToken,
      );
      payload = MercadoLibreToTiendanubeMapper.map(source);
    } catch (error) {
      if (reservation.outcome === 'RESERVED') {
        await this.productLinkRepository.fail({
          ...linkContext,
          linkId: reservation.linkId,
          reservationVersion: reservation.reservationVersion,
        });
      }
      throw error;
    }

    if (reservation.outcome === 'COMPLETED') {
      await this.tiendanubeApiService.put(
        tiendanubeConnection.storeId,
        `/products/${encodeURIComponent(reservation.tiendanubeProductId)}`,
        payload,
        tiendanubeConnection.accessToken,
      );
      return {
        ok: true,
        action: 'updated',
        mercadolibreSourceId: mercadoLibreProduct.id,
        tiendanubeProductId: reservation.tiendanubeProductId,
      };
    }

    const transitionContext = {
      ...linkContext,
      linkId: reservation.linkId,
      reservationVersion: reservation.reservationVersion,
    } as const;

    let createdProduct: TiendanubeCreatedProduct | undefined;
    try {
      createdProduct =
        await this.tiendanubeApiService.post<TiendanubeCreatedProduct>(
          tiendanubeConnection.storeId,
          '/products',
          payload,
          tiendanubeConnection.accessToken,
        );
    } catch (error) {
      if (isDefinitiveRejection(error)) {
        await this.productLinkRepository.fail(transitionContext);
      }
      throw error;
    }

    const tiendanubeProductId = parseCreatedProductId(createdProduct);
    await this.productLinkRepository.complete({
      ...transitionContext,
      tiendanubeProductId,
    });

    return {
      ok: true,
      action: 'created',
      mercadolibreSourceId: mercadoLibreProduct.id,
      tiendanubeProductId,
    };
  }

  async replicate(
    userId: string,
    mlProductId: string,
  ): Promise<TiendanubeReplicationResult> {
    const mercadoLibreConnection =
      await this.mercadoLibreTokenService.getStoredConnection(userId);
    const tiendanubeConnection =
      await this.tiendanubeConnectionRepository.findCredentialsByUserId(userId);

    if (!tiendanubeConnection?.accessToken.trim()) {
      throw new UnauthorizedException(
        'Primero conectá Tiendanube desde /tiendanube/connect',
      );
    }
    this.requireProductWriteScope(tiendanubeConnection.scope);

    const mercadoLibreProduct =
      await this.mercadoLibreProductsRepository.findById(
        mercadoLibreConnection.seller_id,
        mlProductId,
      );
    if (!mercadoLibreProduct) {
      throw new NotFoundException(
        'La publicación de Mercado Libre no existe para el usuario autenticado',
      );
    }

    const linkContext = {
      userId,
      storeId: tiendanubeConnection.storeId,
      mlProductId: mercadoLibreProduct.id,
      mlSourceKey: mercadoLibreProduct.external_key,
    } as const;
    const reservation = await this.productLinkRepository.reserve(linkContext);

    if (reservation.outcome === 'COMPLETED') {
      return {
        ok: true,
        alreadyReplicated: true,
        tiendanubeProductId: reservation.tiendanubeProductId,
      };
    }
    if (reservation.outcome === 'PENDING') {
      throw new ConflictException(
        'La replicación de esta publicación ya está pendiente',
      );
    }

    const transitionContext = {
      ...linkContext,
      linkId: reservation.linkId,
      reservationVersion: reservation.reservationVersion,
    } as const;

    let payload: ReturnType<typeof MercadoLibreToTiendanubeMapper.map>;
    try {
      const mercadoLibreAccessToken =
        await this.mercadoLibreTokenService.getValidAccessToken(
          userId,
          mercadoLibreConnection,
        );
      const source = await this.sourceService.load(
        mercadoLibreProduct,
        mercadoLibreConnection.seller_id,
        mercadoLibreAccessToken,
      );
      payload = MercadoLibreToTiendanubeMapper.map(source);
    } catch (error) {
      await this.productLinkRepository.fail(transitionContext);
      throw error;
    }

    let createdProduct: TiendanubeCreatedProduct | undefined;
    try {
      createdProduct =
        await this.tiendanubeApiService.post<TiendanubeCreatedProduct>(
          tiendanubeConnection.storeId,
          '/products',
          payload,
          tiendanubeConnection.accessToken,
        );
    } catch (error) {
      if (isDefinitiveRejection(error)) {
        await this.productLinkRepository.fail(transitionContext);
      }
      throw error;
    }

    // Una respuesta exitosa sin ID puede corresponder a un producto creado.
    // Se conserva PENDING para impedir que un retry repita el POST.
    const tiendanubeProductId = parseCreatedProductId(createdProduct);

    // Si este CAS falla, el vínculo permanece PENDING. Nunca se reintenta el
    // POST automáticamente porque Tiendanube ya confirmó la creación.
    await this.productLinkRepository.complete({
      ...transitionContext,
      tiendanubeProductId,
    });

    return {
      ok: true,
      alreadyReplicated: false,
      mlProductId: mercadoLibreProduct.id,
      tiendanubeProductId,
    };
  }

  private requireProductWriteScope(scope: string): void {
    const scopes = new Set(scope.split(/[\s,]+/).filter(Boolean));
    if (!scopes.has('write_products')) {
      throw new ForbiddenException(
        'La conexión de Tiendanube no tiene permiso write_products',
      );
    }
  }

  private async ensureCategory(
    storeId: string,
    token: string,
    categoryId: number,
  ): Promise<void> {
    const category = await this.tiendanubeApiService.get<unknown>(
      storeId,
      `/categories/${categoryId}`,
      token,
    );
    if (!category || typeof category !== 'object')
      throw new NotFoundException('La categoría de Tiendanube no existe');
  }
}

function applyOptions(
  product: ReturnType<typeof MercadoLibreToTiendanubeMapper.map>,
  options?: TiendanubeReplicationOptions,
): ReturnType<typeof MercadoLibreToTiendanubeMapper.map> {
  if (!options) return product;
  return {
    ...product,
    categories: [options.categoryId],
    variants:
      options.priceMode === 'OVERRIDE' && options.price !== undefined
        ? product.variants.map((variant) => ({
            ...variant,
            price: options.price!.toFixed(2),
          }))
        : product.variants,
  };
}

function parseCreatedProductId(
  response: TiendanubeCreatedProduct | undefined,
): string {
  const value = response?.id;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  throw new BadGatewayException(
    'Tiendanube devolvió un producto creado inválido',
  );
}

function isDefinitiveRejection(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const status = error.getStatus();
  return status >= 400 && status < 500 && status !== 408;
}
