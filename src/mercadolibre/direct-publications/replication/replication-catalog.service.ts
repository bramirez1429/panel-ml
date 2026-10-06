import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationCatalogScannerService } from '../publications/publication-catalog-scanner.service';
import { PublicationsMapper } from '../publications/publications.mapper';
import type { MlItem } from '../items/items.types';
import type { DirectReplicationProduct } from './replication.types';

type ProductAccumulator = {
  sourceKey: string;
  title: string;
  sold: number;
  thumbnailUrl: string | null;
  familyId: string | null;
  itemId: string | null;
  userProductId: string | null;
  type: 'LEGACY' | 'USER_PRODUCT';
  representativeSold: number;
};

@Injectable()
export class ReplicationCatalogService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly scanner: PublicationCatalogScannerService,
  ) {}

  async getProducts(): Promise<DirectReplicationProduct[]> {
    const connection = await this.tokenService.getSharedStoredConnection();
    const accessToken = await this.tokenService.getSharedValidAccessToken(connection);
    const products = new Map<string, ProductAccumulator>();

    await this.scanner.scan(connection.seller_id, accessToken, undefined, (items) => {
      for (const item of items) this.addItem(products, item);
      return false;
    });

    return [...products.values()]
      .sort((left, right) => right.sold - left.sold || left.title.localeCompare(right.title))
      .map(({ representativeSold: _representativeSold, ...product }) => product);
  }

  private addItem(products: Map<string, ProductAccumulator>, item: MlItem): void {
    const sold = item.sold_quantity ?? 0;
    if (PublicationsMapper.getModel(item) === 'VARIANT_PRICING' && item.family_id) {
      const familyId = String(item.family_id);
      const key = `family:${familyId}`;
      const current = products.get(key);
      if (current) {
        current.sold += sold;
        if (sold > current.representativeSold) {
          current.itemId = item.id;
          current.userProductId = item.user_product_id ?? null;
          current.thumbnailUrl = bestItemImage(item);
          current.representativeSold = sold;
        }
        if (!current.thumbnailUrl) current.thumbnailUrl = bestItemImage(item);
        return;
      }
      products.set(key, {
        sourceKey: key,
        title: item.family_name || item.title || familyId,
        sold,
        thumbnailUrl: bestItemImage(item),
        familyId,
        itemId: item.id,
        userProductId: item.user_product_id ?? null,
        type: 'USER_PRODUCT',
        representativeSold: sold,
      });
      return;
    }

    products.set(`item:${item.id}`, {
      sourceKey: `item:${item.id}`,
      title: item.title || item.id,
      sold,
      thumbnailUrl: bestItemImage(item),
      familyId: null,
      itemId: item.id,
      userProductId: null,
      type: 'LEGACY',
      representativeSold: sold,
    });
  }
}

function bestItemImage(item: MlItem): string | null {
  return item.pictures?.[0]?.secure_url ?? item.pictures?.[0]?.url ?? item.thumbnail ?? null;
}
