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
    consumePage: (items: readonly MlItem[]) => boolean,
  ): Promise<{ reachedEnd: boolean }> {
    let scrollId: string | undefined;

    while (true) {
      const page = await this.publicationSource.fetchNextScanPage(
        sellerId,
        accessToken,
        scrollId,
      );
      if (page.itemIds.length === 0) return { reachedEnd: true };

      const items = await this.itemsService.getMany(page.itemIds, accessToken);
      if (consumePage(items)) return { reachedEnd: false };
      if (!page.scrollId) return { reachedEnd: true };
      scrollId = page.scrollId;
    }
  }
}
