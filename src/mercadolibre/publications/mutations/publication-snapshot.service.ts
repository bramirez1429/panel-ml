import { Injectable } from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import { Json } from '../../../database/database.types';
import {
  LiveVariation,
  ManagedPicture,
  parseLiveAttributes,
  parseLivePictures,
  parseLiveVariations,
  PublicationManagementTarget,
  sellerSku,
} from './publication-management.types';

export type PublicationManagementSnapshot = Readonly<{
  itemId: string;
  status: string | null;
  pictures: ManagedPicture[];
  sku: string | null;
  variations: Array<{
    id: string;
    sku: string | null;
    pictureIds: string[];
  }>;
  refreshedAt: string;
}>;

@Injectable()
export class PublicationSnapshotService {
  constructor(
    private readonly productsRepository: MercadolibreProductsRepository,
    private readonly childrenRepository: MercadolibreChildrenRepository,
  ) {}

  /** Persiste solo el snapshot de gestion del producto afectado. */
  async persist(
    target: PublicationManagementTarget,
    item: Record<string, unknown>,
  ): Promise<PublicationManagementSnapshot> {
    const snapshot = createSnapshot(target.itemId, item);
    if (target.model === 'SHARED') {
      await this.productsRepository.updateManagementSnapshot(target.productId, {
        status: snapshot.status,
        pictures: snapshot.pictures,
        shared_skus: snapshot.variations.length
          ? Object.fromEntries(
              snapshot.variations.map((variation) => [
                variation.id,
                variation.sku,
              ]),
            )
          : { __item__: snapshot.sku },
        management_synced_at: snapshot.refreshedAt,
      });
    } else {
      await this.childrenRepository.updateManagementSnapshot(target.itemId, {
        status: snapshot.status,
        pictures: snapshot.pictures,
        attributes: parseLiveAttributes(item.attributes ?? []) as Json,
        management_synced_at: snapshot.refreshedAt,
      });
      await this.productsRepository.touchManagementSnapshot(
        target.productId,
        snapshot.refreshedAt,
      );
    }
    return snapshot;
  }
}

export function createSnapshot(
  itemId: string,
  item: Record<string, unknown>,
): PublicationManagementSnapshot {
  const variations = parseLiveVariations(item.variations).map(
    toVariationSnapshot,
  );
  return {
    itemId,
    status: typeof item.status === 'string' ? item.status : null,
    pictures: parseLivePictures(item.pictures ?? []),
    sku: sellerSku(parseLiveAttributes(item.attributes ?? [])),
    variations,
    refreshedAt: new Date().toISOString(),
  };
}

function toVariationSnapshot(variation: LiveVariation) {
  return {
    id: String(variation.id),
    sku: sellerSku(variation.attributes),
    pictureIds: [...variation.picture_ids],
  };
}
