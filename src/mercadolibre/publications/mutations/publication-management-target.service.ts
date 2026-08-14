import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductDetail } from '../../../database/repositories/mercadolibre-publications.types';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import type { MercadoLibreConnection } from '../../../database/supabase.service';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import {
  parseOptionalItemId,
  PublicationManagementTarget,
} from './publication-management.types';

export type PublicationManagementContext = Readonly<{
  product: MercadolibreProductDetail;
  target: PublicationManagementTarget;
  sellerId: number;
  accessToken: string;
}>;

export type PublicationManagementProductContext = Readonly<{
  product: MercadolibreProductDetail;
  sellerId: number;
  accessToken: string;
}>;

@Injectable()
export class PublicationManagementTargetService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly productsRepository: MercadolibreProductsRepository,
    private readonly childrenRepository: MercadolibreChildrenRepository,
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Resuelve y valida un MLA editable perteneciente al producto y seller. */
  async resolve(
    productId: string,
    requestedItemId: unknown,
  ): Promise<PublicationManagementContext> {
    const { connection, product } = await this.loadOwnedProduct(productId);
    const itemId = parseOptionalItemId(requestedItemId);
    const target = await this.targetFor(product, itemId);
    const accessToken = await this.tokenService.getValidAccessToken(connection);
    return {
      product,
      target,
      sellerId: connection.seller_id,
      accessToken,
    };
  }

  /** Resuelve ownership del producto sin exigir un hijo de VARIANT_PRICING. */
  async resolveProduct(
    productId: string,
  ): Promise<PublicationManagementProductContext> {
    const { connection, product } = await this.loadOwnedProduct(productId);
    return {
      product,
      sellerId: connection.seller_id,
      accessToken: await this.tokenService.getValidAccessToken(connection),
    };
  }

  /** Resuelve todos los MLA que pertenecen al producto interno. */
  async resolveAll(productId: string): Promise<PublicationManagementContext[]> {
    const { connection, product } = await this.loadOwnedProduct(productId);
    const targets =
      product.model === 'SHARED'
        ? [
            {
              productId,
              model: 'SHARED' as const,
              itemId: requireMla(product.parent_item_id),
              userProductId: null,
            },
          ]
        : await this.familyTargets(productId);
    const accessToken = await this.tokenService.getValidAccessToken(connection);
    return targets.map((target) => ({
      product,
      sellerId: connection.seller_id,
      accessToken,
      target,
    }));
  }

  private async familyTargets(
    productId: string,
  ): Promise<PublicationManagementTarget[]> {
    const children = await this.childrenRepository.findByProductId(productId);
    if (children.length === 0) {
      throw new ConflictException('La familia no tiene items sincronizados');
    }
    return children.map((child) => ({
      productId,
      model: 'VARIANT_PRICING' as const,
      itemId: requireMla(child.item_id),
      userProductId: child.user_product_id,
    }));
  }

  /** Descarga un MLA y verifica su identidad, seller y User Product esperado. */
  async getOwnedItem(
    context: PublicationManagementContext,
    includeAttributes = false,
  ): Promise<Record<string, unknown>> {
    const suffix = includeAttributes ? '?include_attributes=all' : '';
    const item = await this.apiService.get<unknown>(
      `/items/${encodeURIComponent(context.target.itemId)}${suffix}`,
      context.accessToken,
    );
    if (!isJsonObject(item) || item.id !== context.target.itemId) {
      throw new ConflictException('Mercado Libre devolvio otro item');
    }
    if (item.seller_id !== context.sellerId) {
      throw new ForbiddenException('La publicacion pertenece a otro vendedor');
    }
    if (
      context.target.userProductId &&
      item.user_product_id !== context.target.userProductId
    ) {
      throw new ConflictException(
        'El User Product vivo no coincide con el hijo guardado',
      );
    }
    return item;
  }

  private async targetFor(
    product: MercadolibreProductDetail,
    requestedItemId: string | null,
  ): Promise<PublicationManagementTarget> {
    if (product.model === 'SHARED') {
      const itemId = requireMla(product.parent_item_id);
      if (requestedItemId && requestedItemId !== itemId) {
        throw new BadRequestException(
          'itemId no pertenece a la publicacion SHARED',
        );
      }
      return {
        productId: product.id,
        model: product.model,
        itemId,
        userProductId: null,
      };
    }
    if (!requestedItemId) {
      throw new BadRequestException(
        'itemId es obligatorio para VARIANT_PRICING',
      );
    }
    const children = await this.childrenRepository.findByProductId(product.id);
    const child = children.find(({ item_id }) => item_id === requestedItemId);
    if (!child) {
      throw new NotFoundException('El item no pertenece a esta publicacion');
    }
    return {
      productId: product.id,
      model: product.model,
      itemId: requireMla(child.item_id),
      userProductId: child.user_product_id,
    };
  }

  private async loadOwnedProduct(productId: string): Promise<{
    connection: MercadoLibreConnection;
    product: MercadolibreProductDetail;
  }> {
    const connection = await this.tokenService.getStoredConnection();
    const product = await this.productsRepository.findById(
      connection.seller_id,
      productId,
    );
    if (!product) throw new NotFoundException('La publicacion no existe');
    return { connection, product };
  }
}

function requireMla(value: unknown): string {
  if (typeof value !== 'string' || !/^MLA\d+$/.test(value)) {
    throw new ConflictException('La publicacion no tiene un MLA valido');
  }
  return value;
}
