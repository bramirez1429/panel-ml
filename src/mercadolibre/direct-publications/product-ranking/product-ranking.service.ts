import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationCatalogScannerService } from '../publications/publication-catalog-scanner.service';
import { PublicationsMapper } from '../publications/publications.mapper';
import type { MlItem } from '../items/items.types';
import { FamiliesService } from '../families/families.service';
import { ItemsService } from '../items/items.service';
import type { ProductRankingResult, ProductRankingRow, ProductRankingVariant } from './product-ranking.types';
import { ProductRankingVisitsService } from './product-ranking-visits.service';
import type { ProductRankingVisitPeriod } from './product-ranking-period';

type LegacyVariation = {
  id?: string | number;
  sold_quantity?: number;
  picture_ids?: string[];
  attribute_combinations?: Array<{ id?: string; name?: string; value_name?: string | null; values?: Array<{ name?: string | null }> }>;
};

@Injectable()
export class ProductRankingService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly scanner: PublicationCatalogScannerService,
    private readonly familiesService: FamiliesService,
    private readonly itemsService: ItemsService,
    private readonly visitsService: ProductRankingVisitsService,
  ) {}

  async getRanking(days: ProductRankingVisitPeriod): Promise<ProductRankingResult> {
    const connection = await this.tokenService.getSharedStoredConnection();
    const accessToken = await this.tokenService.getSharedValidAccessToken(connection);
    const products = new Map<string, ProductRankingRow>();

    await this.scanner.scan(connection.seller_id, accessToken, undefined, (items) => {
      for (const item of items) this.addItem(products, item);
      return false;
    });

    const visits = await this.visitsService.getVisits(
      [...new Set([...products.values()].flatMap(({ itemIds }) => itemIds))],
      accessToken,
      days,
    );
    for (const product of products.values()) {
      product.visits = sumVisits(product.itemIds, visits);
    }

    const ranked = [...products.values()].sort(
      (a, b) => b.sold - a.sold || a.title.localeCompare(b.title),
    );
    return {
      totalProducts: ranked.length,
      productsWithSales: ranked.filter((product) => product.sold > 0).length,
      visitPeriodDays: days,
      totalVisits: sumAllVisits(visits),
      products: ranked,
    };
  }

  async getVariants(userId: string, type: string, id: string, days: ProductRankingVisitPeriod): Promise<{ variants: ProductRankingVariant[] }> {
    const variants = type === 'family'
      ? await this.getFamilyVariants(userId, id, days)
      : type === 'item'
        ? await this.getLegacyVariants(id)
        : (() => { throw new BadRequestException('Tipo de producto inválido'); })();
    return { variants: variants.sort((a, b) => b.sold - a.sold || a.label.localeCompare(b.label)) };
  }

  private addItem(products: Map<string, ProductRankingRow>, item: MlItem): void {
    const model = PublicationsMapper.getModel(item);
    if (model === 'VARIANT_PRICING' && item.family_id) {
      const key = `family:${String(item.family_id)}`;
      const current = products.get(key);
      if (current) {
        current.sold += item.sold_quantity ?? 0;
        if (!current.itemIds.includes(item.id)) current.itemIds.push(item.id);
        if (item.user_product_id && !current.userProductIds.includes(item.user_product_id)) {
          current.userProductIds.push(item.user_product_id);
        }
        if (!current.thumbnailUrl && item.thumbnail) current.thumbnailUrl = item.thumbnail;
        current.variantsCount = current.itemIds.length;
        return;
      }
      products.set(key, {
        title: item.family_name || item.title || String(item.family_id),
        sold: item.sold_quantity ?? 0,
        visits: null,
        type: 'USER_PRODUCT',
        itemIds: [item.id],
        familyId: String(item.family_id),
        userProductIds: item.user_product_id ? [item.user_product_id] : [],
        thumbnailUrl: item.thumbnail ?? null,
        variantsCount: 1,
      });
      return;
    }

    products.set(`item:${item.id}`, {
      title: item.title || item.id,
      sold: item.sold_quantity ?? 0,
      visits: null,
      type: 'LEGACY',
      itemIds: [item.id],
      familyId: null,
      userProductIds: [],
      thumbnailUrl: item.thumbnail ?? null,
      variantsCount: Array.isArray(item.variations) ? item.variations.length : 0,
    });
  }

  private async getFamilyVariants(userId: string, familyId: string, days: ProductRankingVisitPeriod): Promise<ProductRankingVariant[]> {
    const { items } = await this.familiesService.getFamilyItems(userId, familyId);
    const connection = await this.tokenService.getSharedStoredConnection();
    const accessToken = await this.tokenService.getSharedValidAccessToken(connection);
    const visits = await this.visitsService.getVisits(
      [...new Set(items.map(({ id }) => id))],
      accessToken,
      days,
    );
    return items.map((item) => ({
      id: item.user_product_id || item.id,
      label: this.itemLabel(item),
      itemId: item.id,
      userProductId: item.user_product_id ?? null,
      sold: item.sold_quantity ?? 0,
      visits: visits.get(item.id) ?? null,
      thumbnailUrl: item.thumbnail ?? null,
    }));
  }

  private async getLegacyVariants(itemId: string): Promise<ProductRankingVariant[]> {
    const connection = await this.tokenService.getSharedStoredConnection();
    const accessToken = await this.tokenService.getSharedValidAccessToken(connection);
    const item = await this.itemsService.getOne(itemId, accessToken);
    const variations = Array.isArray(item.variations) ? item.variations as LegacyVariation[] : [];
    return variations.map((variation, index) => ({
      id: `${item.id}:${String(variation.id ?? index)}`,
      label: this.attributesLabel(variation.attribute_combinations) || item.title || item.id,
      itemId: item.id,
      userProductId: null,
      sold: variation.sold_quantity ?? 0,
      visits: null,
      thumbnailUrl: this.variationThumbnail(item, variation),
    }));
  }

  private itemLabel(item: MlItem): string {
    return this.attributesLabel(item.attributes) || item.title || item.user_product_id || item.id;
  }

  private attributesLabel(attributes?: Array<{ id?: string; name?: string; value_name?: string | null; values?: Array<{ name?: string | null }> }>): string {
    if (!attributes?.length) return '';
    const preferred = attributes.filter(({ id, name }) => /COLOR|SIZE|TALLE|COLOR/i.test(`${id ?? ''} ${name ?? ''}`));
    const source = preferred.length ? preferred : attributes;
    return [...new Set(source.map((attribute) => attribute.value_name ?? attribute.values?.[0]?.name ?? null).filter((value): value is string => Boolean(value)))].join(' / ');
  }

  private variationThumbnail(item: MlItem, variation: LegacyVariation): string | null {
    const pictureId = variation.picture_ids?.[0];
    if (pictureId) {
      const picture = item.pictures?.find(({ id }) => id === pictureId);
      if (picture) return picture.secure_url ?? picture.url ?? item.thumbnail ?? null;
    }
    return item.thumbnail ?? null;
  }
}

function sumVisits(
  itemIds: readonly string[],
  visits: ReadonlyMap<string, number | null>,
): number | null {
  const uniqueItemIds = [...new Set(itemIds)];
  if (!uniqueItemIds.length) return null;
  let total = 0;
  for (const itemId of uniqueItemIds) {
    const value = visits.get(itemId);
    if (value === null || value === undefined) return null;
    total += value;
  }
  return total;
}

function sumAllVisits(
  visits: ReadonlyMap<string, number | null>,
): number | null {
  let total = 0;
  for (const value of visits.values()) {
    if (value === null) return null;
    total += value;
  }
  return total;
}
