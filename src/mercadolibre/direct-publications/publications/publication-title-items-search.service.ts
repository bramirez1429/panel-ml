import { BadRequestException, Injectable } from '@nestjs/common';

import type { MlItem } from '../items/items.types';
import { PublicationCatalogScannerService } from './publication-catalog-scanner.service';
import {
  decodeTitleSearchCursor,
  encodeTitleSearchCursor,
  titleMatchesSearch,
} from './publication-title-search.helpers';

@Injectable()
export class PublicationTitleItemsSearchService {
  constructor(private readonly scanner: PublicationCatalogScannerService) {}

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
    const offset = decodeTitleSearchCursor(cursor);
    if (offset === null) {
      throw new BadRequestException('cursor de búsqueda inválido');
    }

    const target = offset + limit;
    const matches: MlItem[] = [];
    const seen = new Set<string>();
    const scan = await this.scanner.scan(sellerId, accessToken, (items) => {
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (titleMatchesSearch(item.title, query)) matches.push(item);
      }
      return matches.length >= target;
    });

    const items = matches.slice(offset, target);
    const nextOffset = offset + items.length;
    const done = scan.reachedEnd && nextOffset >= matches.length;
    return {
      done,
      nextCursor: done ? null : encodeTitleSearchCursor(nextOffset),
      items,
    };
  }
}
