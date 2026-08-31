import { BadRequestException, Injectable } from '@nestjs/common';

import { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import { PublicationCatalogScannerService } from './publication-catalog-scanner.service';
import { titleMatchesSearch } from './publication-title-search.helpers';
import {
  decodePublicationTitleItemsCursor,
  encodePublicationTitleItemsCursor,
  type PublicationTitleItemsCursor,
} from './publication-title-items-cursor';

@Injectable()
export class PublicationTitleItemsSearchService {
  constructor(
    private readonly scanner: PublicationCatalogScannerService,
    private readonly itemsService: ItemsService,
  ) {}

  async search(
    sellerId: number,
    accessToken: string,
    query: string,
    limit: number,
    cursor?: string,
  ): Promise<{
    done: boolean;
    nextCursor: string | null;
    items: MlItem[];
  }> {
    const state = decodePublicationTitleItemsCursor(cursor);
    if (state === null) {
      throw new BadRequestException('cursor de búsqueda inválido');
    }

    const matches = await this.loadPendingItems(
      state,
      sellerId,
      accessToken,
      query,
    );
    const items = matches.slice(0, limit);
    const pendingItemIds = matches.slice(limit).map(({ id }) => id);

    if (items.length >= limit || state.reachedEnd) {
      return this.pageFromState(items, pendingItemIds, state);
    }

    const scan = await this.scanner.scan(
      sellerId,
      accessToken,
      state.nextScrollId ?? undefined,
      (page) => {
        for (const item of page) {
          if (!titleMatchesSearch(item.title, query)) continue;
          if (items.length < limit) items.push(item);
          else pendingItemIds.push(item.id);
        }
        return items.length >= limit;
      },
    );

    const done = scan.reachedEnd && pendingItemIds.length === 0;
    return {
      done,
      nextCursor: done
        ? null
        : encodePublicationTitleItemsCursor({
            nextScrollId: scan.nextScrollId,
            pendingItemIds,
            reachedEnd: scan.reachedEnd,
          }),
      items,
    };
  }

  private pageFromState(
    items: MlItem[],
    pendingItemIds: string[],
    state: PublicationTitleItemsCursor,
  ) {
    const done = state.reachedEnd && pendingItemIds.length === 0;
    return {
      done,
      nextCursor: done
        ? null
        : encodePublicationTitleItemsCursor({
            ...state,
            pendingItemIds,
          }),
      items,
    };
  }

  private async loadPendingItems(
    state: PublicationTitleItemsCursor,
    sellerId: number,
    accessToken: string,
    query: string,
  ): Promise<MlItem[]> {
    if (state.pendingItemIds.length === 0) return [];
    const items = await this.itemsService.getMany(
      state.pendingItemIds,
      accessToken,
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    return state.pendingItemIds.flatMap((itemId) => {
      const item = byId.get(itemId);
      return item &&
        String(item.seller_id) === String(sellerId) &&
        titleMatchesSearch(item.title, query)
        ? [item]
        : [];
    });
  }
}
