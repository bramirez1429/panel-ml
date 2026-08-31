import { BadRequestException, Injectable } from '@nestjs/common';

import { FamiliesService } from '../families/families.service';
import type { FamilySummary } from '../families/family.types';
import type { MlItem } from '../items/items.types';
import type { SharedProduct } from './publication.types';
import { PublicationCatalogScannerService } from './publication-catalog-scanner.service';
import {
  decodeTitleSearchCursor,
  encodeTitleSearchCursor,
  titleMatchesSearch,
} from './publication-title-search.helpers';
import { PublicationsMapper } from './publications.mapper';

type GroupedReference =
  | { model: 'SHARED'; product: SharedProduct; rawItemsCount: 1 }
  | { model: 'VARIANT_PRICING'; familyId: string; rawItemsCount: number };

@Injectable()
export class PublicationsGlobalSearchService {
  constructor(
    private readonly scanner: PublicationCatalogScannerService,
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

    const target = offset + limit;
    const scan = await this.collectReferences(
      sellerId,
      accessToken,
      search,
      target,
    );
    const page = scan.references.slice(offset, target);
    const products = await this.resolvePage(userId, page);
    const nextOffset = offset + page.length;
    const done = scan.reachedEnd && nextOffset >= scan.references.length;

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

  private async collectReferences(
    sellerId: number,
    accessToken: string,
    search: string,
    target: number,
  ): Promise<{
    references: GroupedReference[];
    reachedEnd: boolean;
  }> {
    const references: GroupedReference[] = [];
    const seenItems = new Set<string>();
    const families = new Map<string, GroupedReference>();
    const scan = await this.scanner.scan(sellerId, accessToken, (items) => {
      this.appendMatches(items, search, references, families, seenItems);
      return references.length >= target;
    });

    return { references, reachedEnd: scan.reachedEnd };
  }

  private appendMatches(
    items: readonly MlItem[],
    search: string,
    references: GroupedReference[],
    families: Map<string, GroupedReference>,
    seenItems: Set<string>,
  ): void {
    for (const item of items) {
      if (seenItems.has(item.id)) continue;
      seenItems.add(item.id);
      if (!titleMatchesSearch(item.title, search)) continue;

      if (PublicationsMapper.getModel(item) === 'SHARED') {
        references.push({
          model: 'SHARED',
          product: PublicationsMapper.toSharedProduct(item),
          rawItemsCount: 1,
        });
        continue;
      }

      if (!item.family_id) continue;
      const familyId = String(item.family_id);
      const existing = families.get(familyId);
      if (existing) {
        existing.rawItemsCount += 1;
        continue;
      }
      const reference: GroupedReference = {
        model: 'VARIANT_PRICING',
        familyId,
        rawItemsCount: 1,
      };
      families.set(familyId, reference);
      references.push(reference);
    }
  }

  private async resolvePage(
    userId: string,
    references: readonly GroupedReference[],
  ): Promise<Array<SharedProduct | FamilySummary>> {
    const products: Array<SharedProduct | FamilySummary> = [];
    for (const reference of references) {
      products.push(
        reference.model === 'SHARED'
          ? reference.product
          : await this.familiesService.getSummary(userId, reference.familyId),
      );
    }
    return products;
  }
}
