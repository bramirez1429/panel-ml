import { Injectable } from '@nestjs/common';

import { PublicationSourceService } from '../../publications/sync/publication-source.service';
import { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

@Injectable()
export class PublicationCatalogScannerService {
  constructor(
    private readonly publicationSource: PublicationSourceService,
    private readonly itemsService: ItemsService,
  ) {}

  async scan(
    sellerId: number,
    accessToken: string,
    startingScrollId: string | undefined,
    consumePage: (items: readonly MlItem[]) => boolean,
  ): Promise<{ reachedEnd: boolean; nextScrollId: string | null }> {
    let scrollId = startingScrollId;

    while (true) {
      const page = await this.publicationSource.fetchNextScanPage(
        sellerId,
        accessToken,
        scrollId,
      );
      if (page.itemIds.length === 0) {
        return { reachedEnd: true, nextScrollId: null };
      }

      const items = await this.itemsService.getMany(page.itemIds, accessToken);
      if (consumePage(items)) {
        return {
          reachedEnd: !page.scrollId,
          nextScrollId: page.scrollId,
        };
      }
      if (!page.scrollId) return { reachedEnd: true, nextScrollId: null };
      scrollId = page.scrollId;
    }
  }
}
