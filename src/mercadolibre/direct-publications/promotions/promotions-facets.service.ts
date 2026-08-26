import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationSourceService } from '../../publications/sync/publication-source.service';
import { ItemsService } from '../items/items.service';
import { normalizeTitleSearch } from '../publications/publication-title-search.helpers';

import { MercadoLibreCategoriesService } from './mercadolibre-categories.service';
import { toPromotionCandidate } from './promotions-catalog.helpers';
import type {
  PromotionAttributeFacet,
  PromotionCategoryFacet,
} from './promotions-catalog.types';

type AttributeAccumulator = {
  name: string;
  values: Map<string, { value: string; count: number }>;
};

@Injectable()
export class PromotionsFacetsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly publicationSource: PublicationSourceService,
    private readonly itemsService: ItemsService,
    private readonly categoriesService: MercadoLibreCategoriesService,
  ) {}

  async getFacets(userId: string): Promise<{
    categories: PromotionCategoryFacet[];
    attributes: PromotionAttributeFacet[];
  }> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const categoryCounts = new Map<string, number>();
    const attributes = new Map<string, AttributeAccumulator>();
    const seenItems = new Set<string>();
    let scrollId: string | undefined;

    while (true) {
      const scan = await this.publicationSource.fetchNextScanPage(
        connection.seller_id,
        accessToken,
        scrollId,
      );
      if (scan.itemIds.length === 0) break;
      const items = await this.itemsService.getMany(scan.itemIds, accessToken);
      for (const item of items) {
        if (seenItems.has(item.id)) continue;
        seenItems.add(item.id);
        const candidate = toPromotionCandidate(item);
        if (!candidate) continue;
        categoryCounts.set(
          candidate.categoryId,
          (categoryCounts.get(candidate.categoryId) ?? 0) + 1,
        );
        for (const attribute of candidate.attributes) {
          const current = attributes.get(attribute.id) ?? {
            name: attribute.name,
            values: new Map<string, { value: string; count: number }>(),
          };
          const valueKey = normalizeTitleSearch(attribute.value);
          const value = current.values.get(valueKey) ?? {
            value: attribute.value,
            count: 0,
          };
          value.count += 1;
          current.values.set(valueKey, value);
          attributes.set(attribute.id, current);
        }
      }
      if (!scan.scrollId) break;
      scrollId = scan.scrollId;
    }

    const categoryDetails = await this.categoriesService.getMany(
      [...categoryCounts.keys()],
      accessToken,
    );
    const categories = [...categoryCounts].flatMap(([id, count]) => {
      const category = categoryDetails.get(id);
      return category ? [{ ...category, count }] : [];
    });
    return {
      categories,
      attributes: [...attributes].map(([id, attribute]) => ({
        id,
        name: attribute.name,
        values: [...attribute.values.values()],
      })),
    };
  }
}
