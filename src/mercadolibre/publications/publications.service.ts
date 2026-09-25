import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../database/repositories/mercadolibre-products.repository';
import { MercadolibreSyncErrorsRepository } from '../../database/repositories/mercadolibre-sync-errors.repository';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { PublicationSyncQueueService } from './sync/publication-sync-queue.service';

@Injectable()
export class PublicationsService {
  /** Recibe la conexión y los repositories de lectura. */
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly productsRepository: MercadolibreProductsRepository,
    private readonly childrenRepository: MercadolibreChildrenRepository,
    private readonly apiService: MercadolibreApiService,
    private readonly syncErrors: MercadolibreSyncErrorsRepository,
    private readonly syncQueue: PublicationSyncQueueService,
  ) {}

  /** Lista resúmenes paginados desde Supabase. */
  async list(userId: string, page = 1, limit = 20) {
    this.validatePaging(page, limit);
    const connection = await this.tokenService.getStoredConnection(userId);
    const result = await this.productsRepository.findPage(
      connection.seller_id,
      page,
      limit,
    );

    return {
      paging: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
      count: result.products.length,
      publications: result.products,
    };
  }

  /** Devuelve un producto guardado y sus hijos cuando corresponde. */
  async findOne(userId: string, productId: string) {
    this.validateProductId(productId);
    const connection = await this.tokenService.getStoredConnection(userId);
    const product = await this.productsRepository.findById(
      connection.seller_id,
      productId,
    );

    if (!product) {
      throw new NotFoundException('Publicación no encontrada');
    }
    if (product.model === 'SHARED') return { product };

    const children = await this.childrenRepository.findByProductId(product.id);
    return { product, children };
  }

  /** Valida la paginación solicitada. */
  private validatePaging(page: number, limit: number): void {
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser un entero mayor que cero');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
  }

  /** Valida la PK UUID interna del producto. */
  private validateProductId(productId: string): void {
    if (!UUID_PATTERN.test(productId)) {
      throw new BadRequestException('productId debe ser un UUID válido');
    }
  }

  /** Modifica el precio real de una publicación en Mercado Libre. */
  async updatePrice(
    userId: string,
    productId: string,
    price: number,
    itemId?: string,
  ) {
    this.validateProductId(productId);

    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('El precio debe ser mayor que cero');
    }

    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );

    const product = await this.productsRepository.findById(
      connection.seller_id,
      productId,
    );

    if (!product) {
      throw new NotFoundException('Publicación no encontrada');
    }

    if (product.model === 'SHARED') {
      if (!product.parent_item_id) {
        throw new BadRequestException('La publicación no tiene MLA asociado');
      }

      await this.apiService.put(
        `/items/${product.parent_item_id}`,
        { price },
        accessToken,
      );

      return this.finishProviderWrite(
        connection.seller_id,
        product.parent_item_id,
        () => this.productsRepository.updatePrice(product.id, price),
        {
          ok: true,
          itemId: product.parent_item_id,
          price,
        },
      );
    }

    if (!itemId) {
      throw new BadRequestException(
        'itemId es obligatorio para publicaciones con variantes',
      );
    }

    const children = await this.childrenRepository.findByProductId(product.id);

    const child = children.find(
      (publication) => publication.item_id === itemId,
    );

    if (!child) {
      throw new BadRequestException('El MLA no pertenece a esta publicación');
    }

    await this.apiService.put(
      `/items/${child.item_id}`,
      { price },
      accessToken,
    );
    // Mercado Libre respondió OK → actualizar Supabase
    return this.finishProviderWrite(
      connection.seller_id,
      child.item_id,
      () => this.childrenRepository.updatePrice(child.item_id, price),
      { ok: true, itemId: child.item_id, price },
    );
  }

  /** Modifica el stock real en Mercado Libre. */
  async updateStock(
    userId: string,
    productId: string,
    stock: number,
    itemId?: string,
    variationId?: number,
  ) {
    this.validateProductId(productId);

    if (!Number.isInteger(stock) || stock < 0) {
      throw new BadRequestException(
        'El stock debe ser un entero mayor o igual a cero',
      );
    }

    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );

    const product = await this.productsRepository.findById(
      connection.seller_id,
      productId,
    );

    if (!product) {
      throw new NotFoundException('Publicación no encontrada');
    }

    // Publicación nueva: cada hijo tiene su propio MLA.
    if (product.model === 'VARIANT_PRICING') {
      if (!itemId) {
        throw new BadRequestException(
          'itemId es obligatorio para publicaciones con variantes',
        );
      }

      const children = await this.childrenRepository.findByProductId(
        product.id,
      );

      const child = children.find(
        (publication) => publication.item_id === itemId,
      );

      if (!child) {
        throw new BadRequestException('El MLA no pertenece a esta publicación');
      }

      await this.apiService.put(
        `/items/${child.item_id}`,
        { available_quantity: stock },
        accessToken,
      );

      return this.finishProviderWrite(
        connection.seller_id,
        child.item_id,
        () => this.childrenRepository.updateStock(child.item_id, stock),
        { ok: true, itemId: child.item_id, stock },
      );
    }

    // Publicación vieja SHARED.
    if (!product.parent_item_id) {
      throw new BadRequestException('La publicación no tiene MLA asociado');
    }

    // SHARED sin variación.
    if (!variationId) {
      await this.apiService.put(
        `/items/${product.parent_item_id}`,
        { available_quantity: stock },
        accessToken,
      );

      return this.finishProviderWrite(
        connection.seller_id,
        product.parent_item_id,
        () => this.productsRepository.updateStock(product.id, stock),
        { ok: true, itemId: product.parent_item_id, stock },
      );
    }

    // SHARED con variaciones: traerlas para conservar todos los IDs.
    const item = await this.apiService.get<{
      variations?: Array<{ id: number }>;
    }>(`/items/${product.parent_item_id}`, accessToken);

    const variations = item.variations ?? [];

    const exists = variations.some((variation) => variation.id === variationId);

    if (!exists) {
      throw new BadRequestException(
        'La variación no pertenece a esta publicación',
      );
    }

    await this.apiService.put(
      `/items/${product.parent_item_id}`,
      {
        variations: variations.map((variation) =>
          variation.id === variationId
            ? {
                id: variation.id,
                available_quantity: stock,
              }
            : {
                id: variation.id,
              },
        ),
      },
      accessToken,
    );

    return this.finishProviderWrite(
      connection.seller_id,
      product.parent_item_id,
      () =>
        this.productsRepository.updateVariationStock(
          product.id,
          variationId,
          stock,
        ),
      { ok: true, itemId: product.parent_item_id, variationId, stock },
    );
  }

  private async finishProviderWrite<T extends Record<string, unknown>>(
    sellerId: number,
    itemId: string,
    updateMirror: () => Promise<void>,
    response: T,
  ): Promise<
    T & { providerUpdated: true; mirrorUpdated: boolean; warning?: string }
  > {
    try {
      await updateMirror();
      return { ...response, providerUpdated: true, mirrorUpdated: true };
    } catch {
      await Promise.allSettled([
        this.syncErrors.createMany([
          {
            sync_job_id: null,
            seller_id: sellerId,
            item_id: itemId,
            error_type: 'MIRROR_WRITE_FAILED',
            error_message:
              'Mercado Libre fue actualizado pero falló la copia local',
          },
        ]),
        this.syncQueue.enqueueRepair(sellerId, itemId),
      ]);
      return {
        ...response,
        providerUpdated: true,
        mirrorUpdated: false,
        warning:
          'Mercado Libre fue actualizado, pero la copia local quedó pendiente de sincronización.',
      };
    }
  }

  /** Obtiene las promociones de todos los MLA de una publicación. */
  async getPromotions(userId: string, productId: string) {
    this.validateProductId(productId);

    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );

    const product = await this.productsRepository.findById(
      connection.seller_id,
      productId,
    );

    if (!product) {
      throw new NotFoundException('Publicación no encontrada');
    }

    let itemIds: string[] = [];

    if (product.model === 'SHARED') {
      if (!product.parent_item_id) {
        throw new BadRequestException('La publicación no tiene MLA asociado');
      }

      itemIds = [product.parent_item_id];
    } else {
      const children = await this.childrenRepository.findByProductId(
        product.id,
      );

      itemIds = children.map((child) => child.item_id);
    }

    const items = [];

    for (const itemId of itemIds) {
      const promotions = await this.apiService.get<unknown[]>(
        `/seller-promotions/items/${itemId}?app_version=v2`,
        accessToken,
      );

      items.push({
        itemId,
        promotions,
      });
    }

    return {
      productId,
      items,
    };
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
