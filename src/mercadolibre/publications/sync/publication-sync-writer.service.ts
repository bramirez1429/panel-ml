import { Injectable } from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import { NormalizedPublicationBundle } from '../publication.types';

@Injectable()
export class PublicationSyncWriterService {
  /** Recibe repositories que escriben el snapshot normalizado. */
  constructor(
    private readonly productsRepository: MercadolibreProductsRepository,
    private readonly childrenRepository: MercadolibreChildrenRepository,
  ) {}

  /** Guarda un producto completo y marca el full sync al finalizar. */
  async save(
    bundle: NormalizedPublicationBundle,
    fullSyncId?: string,
  ): Promise<void> {
    const product = await this.productsRepository.upsert(bundle.parent);

    if (bundle.parent.model === 'SHARED') {
      await this.saveShared(product.id, bundle);
    } else {
      await this.saveFamily(product.id, bundle);
    }

    if (fullSyncId) {
      await this.productsRepository.markFullSync(
        bundle.parent.seller_id,
        [bundle.parent.external_key],
        fullSyncId,
      );
    }
  }

  /** Elimina productos que no aparecieron en el snapshot completo. */
  async finalizeFullSync(
    sellerId: number,
    fullSyncId: string,
    syncStartedAt: string,
  ): Promise<void> {
    await this.productsRepository.deleteNotSeenInFullSync(
      sellerId,
      fullSyncId,
      syncStartedAt,
    );
  }

  /** Guarda SHARED sin crear hijos relacionales. */
  private async saveShared(
    productId: string,
    bundle: NormalizedPublicationBundle,
  ): Promise<void> {
    const itemId = bundle.parent.parent_item_id;
    if (itemId) await this.childrenRepository.deleteByItemId(itemId);
    await this.childrenRepository.deleteByProductId(productId);
  }

  /** Guarda todos los MLA de una familia y elimina hijos fantasma. */
  private async saveFamily(
    productId: string,
    bundle: NormalizedPublicationBundle,
  ): Promise<void> {
    const children = bundle.children.map((child) => ({
      ...child,
      product_id: productId,
    }));
    await this.childrenRepository.upsertMany(children);

    const itemIds = children.map(({ item_id }) => item_id);
    await this.childrenRepository.deleteMissingChildren(productId, itemIds);
    await this.productsRepository.deleteByExternalKeys(
      bundle.parent.seller_id,
      itemIds.map((itemId) => `item:${itemId}`),
    );
  }
}
