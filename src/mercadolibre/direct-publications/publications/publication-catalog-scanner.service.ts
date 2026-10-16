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
    return this.scanStatus(
      sellerId,
      accessToken,
      startingScrollId,
      undefined,
      consumePage,
    );
  }

  /** Recorre explícitamente publicaciones activas y pausadas sin mezclar scrolls. */
  async scanActiveAndPaused(
    sellerId: number,
    accessToken: string,
    consumePage: (items: readonly MlItem[]) => boolean,
  ): Promise<void> {
    for (const status of ['active', 'paused'] as const) {
      const result = await this.scanStatus(
        sellerId,
        accessToken,
        undefined,
        status,
        consumePage,
      );
      if (!result.reachedEnd) return;
    }
  }

  private async scanStatus(
    sellerId: number,
    accessToken: string,
    startingScrollId: string | undefined,
    status: 'active' | 'paused' | undefined,
    consumePage: (items: readonly MlItem[]) => boolean,
  ): Promise<{ reachedEnd: boolean; nextScrollId: string | null }> {
    let scrollId = startingScrollId;

    while (true) {
      const page =
        status === undefined
          ? await this.publicationSource.fetchNextScanPage(
              sellerId,
              accessToken,
              scrollId,
            )
          : await this.publicationSource.fetchNextScanPage(
              sellerId,
              accessToken,
              scrollId,
              status,
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
