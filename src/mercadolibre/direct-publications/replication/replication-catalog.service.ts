import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationCatalogScannerService } from '../publications/publication-catalog-scanner.service';
import { PublicationsMapper } from '../publications/publications.mapper';
import { ProductRankingVisitsService } from '../product-ranking/product-ranking-visits.service';
import type { MlItem } from '../items/items.types';
import type {
  DirectReplicationProduct,
  ReplicationVisitsRequest,
  ReplicationVisitsResponse,
} from './replication.types';

type ProductAccumulator = {
  sourceKey: string;
  itemIds: string[];
  title: string;
  sold: number;
  priceFrom: number | null;
  priceTo: number | null;
  currency: string | null;
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
    private readonly visitsService: ProductRankingVisitsService,
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

  async getVisits(
    request: ReplicationVisitsRequest,
  ): Promise<ReplicationVisitsResponse> {
    const { days, products } = parseVisitsRequest(request);
    const connection = await this.tokenService.getSharedStoredConnection();
    const accessToken = await this.tokenService.getSharedValidAccessToken(connection);
    const uniqueItemIds = [...new Set(products.flatMap(({ itemIds }) => itemIds))];
    const visits = await this.visitsService.getVisits(uniqueItemIds, accessToken, days);

    return {
      items: products.map(({ sourceKey, itemIds }) => ({
        sourceKey,
        visits: sumProductVisits(itemIds, visits),
      })),
    };
  }

  private addItem(products: Map<string, ProductAccumulator>, item: MlItem): void {
    const sold = item.sold_quantity ?? 0;
    if (PublicationsMapper.getModel(item) === 'VARIANT_PRICING' && item.family_id) {
      const familyId = String(item.family_id);
      const key = `family:${familyId}`;
      const current = products.get(key);
      if (current) {
        current.sold += sold;
        if (!current.itemIds.includes(item.id)) current.itemIds.push(item.id);
        const price = validPrice(item.price);
        if (price !== null) {
          current.priceFrom = current.priceFrom === null ? price : Math.min(current.priceFrom, price);
          current.priceTo = current.priceTo === null ? price : Math.max(current.priceTo, price);
        }
        if (!current.currency && item.currency_id) current.currency = item.currency_id;
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
        itemIds: [item.id],
        title: item.family_name || item.title || familyId,
        sold,
        priceFrom: validPrice(item.price),
        priceTo: validPrice(item.price),
        currency: item.currency_id ?? null,
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
      itemIds: [item.id],
      title: item.title || item.id,
      sold,
      priceFrom: item.price ?? null,
      priceTo: item.price ?? null,
      currency: item.currency_id ?? null,
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

function validPrice(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

type RequestedProduct = Readonly<{ sourceKey: string; itemIds: string[] }>;

function parseVisitsRequest(request: ReplicationVisitsRequest): {
  days: number;
  products: RequestedProduct[];
} {
  if (!request || typeof request !== 'object') {
    throw new BadRequestException('Solicitud de visitas inválida');
  }
  if (
    typeof request.days !== 'number' ||
    !Number.isSafeInteger(request.days) ||
    request.days <= 0 ||
    request.days > 365
  ) {
    throw new BadRequestException('days debe ser un entero positivo entre 1 y 365');
  }
  if (!Array.isArray(request.products) || request.products.length > 20) {
    throw new BadRequestException('products debe contener entre 1 y 20 productos');
  }

  const products = request.products.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Producto de visitas inválido');
    }
    const sourceKey = (value as { sourceKey?: unknown }).sourceKey;
    const itemIds = (value as { itemIds?: unknown }).itemIds;
    if (
      typeof sourceKey !== 'string' ||
      !sourceKey.trim() ||
      !Array.isArray(itemIds) ||
      itemIds.length === 0 ||
      itemIds.some((itemId) => typeof itemId !== 'string' || !itemId.trim())
    ) {
      throw new BadRequestException('Producto de visitas inválido');
    }
    return {
      sourceKey,
      itemIds: [...new Set(itemIds as string[])],
    };
  });

  return { days: request.days, products };
}

function sumProductVisits(
  itemIds: readonly string[],
  visits: ReadonlyMap<string, number | null>,
): number | null {
  let total = 0;
  let hasNumericValue = false;
  for (const itemId of itemIds) {
    const value = visits.get(itemId);
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total += value;
    hasNumericValue = true;
  }
  return hasNumericValue ? total : null;
}
