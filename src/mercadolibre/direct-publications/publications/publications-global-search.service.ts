import { BadRequestException, Injectable } from '@nestjs/common';

import { PublicationSourceService } from '../../publications/sync/publication-source.service';
import { FamiliesService } from '../families/families.service';
import type { FamilySummary } from '../families/family.types';
import { ItemsService } from '../items/items.service';
import type { SharedProduct } from './publication.types';
import {
  decodeTitleSearchCursor,
  encodeTitleSearchCursor,
  titleMatchesSearch,
} from './publication-title-search.helpers';
import { PublicationsMapper } from './publications.mapper';

type GroupedReference =
  | Readonly<{
      model: 'SHARED';
      product: SharedProduct;
      rawItemsCount: 1;
    }>
  | Readonly<{
      model: 'VARIANT_PRICING';
      familyId: string;
      rawItemsCount: number;
    }>;

@Injectable()
export class PublicationsGlobalSearchService {
  constructor(
    private readonly publicationSource: PublicationSourceService,
    private readonly itemsService: ItemsService,
    private readonly familiesService: FamiliesService,
  ) {}

  async search(
    userId: string,
    sellerId: number,
    accessToken: string,
    search: string,
    limit: number,
    cursor?: string,
  ) {
    const offset = decodeTitleSearchCursor(cursor);
    if (offset === null)
      throw new BadRequestException('cursor de búsqueda inválido');

    const itemIds = await this.publicationSource.getAllItemIds(
      sellerId,
      accessToken,
    );
    const items = await this.itemsService.getMany(itemIds, accessToken);
    const matches = items.filter((item) =>
      titleMatchesSearch(item.title, search),
    );
    const references = this.groupReferences(matches);
    const page = references.slice(offset, offset + limit);
    const products: Array<SharedProduct | FamilySummary> = [];

    for (const reference of page) {
      products.push(
        reference.model === 'SHARED'
          ? reference.product
          : await this.familiesService.getSummary(userId, reference.familyId),
      );
    }

    const nextOffset = offset + page.length;
    const done = nextOffset >= references.length;
    return {
      done,
      nextCursor: done ? null : encodeTitleSearchCursor(nextOffset),
      rawItemsCount: page.reduce(
        (total, reference) => total + reference.rawItemsCount,
        0,
      ),
      productsCount: products.length,
      products,
    };
  }

  private groupReferences(
    items: Parameters<typeof PublicationsMapper.getFamilyIds>[0],
  ): GroupedReference[] {
    const shared = items
      .filter((item) => PublicationsMapper.getModel(item) === 'SHARED')
      .map((item): GroupedReference => ({
        model: 'SHARED',
        product: PublicationsMapper.toSharedProduct(item),
        rawItemsCount: 1,
      }));
    const familyCounts = new Map<string, number>();
    for (const item of items) {
      if (
        PublicationsMapper.getModel(item) !== 'VARIANT_PRICING' ||
        !item.family_id
      ) {
        continue;
      }
      const familyId = String(item.family_id);
      familyCounts.set(familyId, (familyCounts.get(familyId) ?? 0) + 1);
    }
    const families = PublicationsMapper.getFamilyIds(items).map(
      (familyId): GroupedReference => ({
        model: 'VARIANT_PRICING',
        familyId,
        rawItemsCount: familyCounts.get(familyId) ?? 0,
      }),
    );
    return [...shared, ...families];
  }
}
