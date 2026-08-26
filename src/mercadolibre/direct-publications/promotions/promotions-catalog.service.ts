import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../../publications/publication.constants';
import { PublicationSourceService } from '../../publications/sync/publication-source.service';
import { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import { MercadoLibreCategoriesService } from './mercadolibre-categories.service';
import {
  decodePromotionsCursor,
  encodePromotionsCursor,
  matchesProductFilters,
  matchesPromotionFilters,
  summarizePromotions,
  toPromotionCandidate,
} from './promotions-catalog.helpers';
import type {
  PromotionCatalogMatch,
  PromotionCatalogQuery,
  PromotionCatalogRow,
} from './promotions-catalog.types';
import { PromotionsService } from './promotions.service';

@Injectable()
export class PromotionsCatalogService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly publicationSource: PublicationSourceService,
    private readonly itemsService: ItemsService,
    private readonly promotionsService: PromotionsService,
    private readonly categoriesService: MercadoLibreCategoriesService,
  ) {}

  async getCatalog(userId: string, query: PromotionCatalogQuery) {
    const offset = decodePromotionsCursor(query.cursor);
    if (offset === null)
      throw new BadRequestException('cursor de promociones inválido');
    const target = offset + query.limit;
    if (!Number.isSafeInteger(target))
      throw new BadRequestException('cursor de promociones inválido');

    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const collected = await this.collectPage(
      userId,
      connection.seller_id,
      accessToken,
      query,
      offset,
      target,
    );
    const categories = await this.categoriesService.getMany(
      collected.matches.map(({ candidate }) => candidate.categoryId),
      accessToken,
    );
    const publications = collected.matches.map((match) =>
      this.toRow(match, categories),
    );
    const nextOffset = offset + publications.length;
    const done = collected.reachedEnd;

    return {
      done,
      nextCursor: done ? null : encodePromotionsCursor(nextOffset),
      count: publications.length,
      publications,
    };
  }

  private async collectPage(
    userId: string,
    sellerId: number,
    accessToken: string,
    query: PromotionCatalogQuery,
    offset: number,
    target: number,
  ): Promise<{
    matches: PromotionCatalogMatch[];
    reachedEnd: boolean;
  }> {
    const matches: PromotionCatalogMatch[] = [];
    const seenItems = new Set<string>();
    let matchedCount = 0;
    let scrollId: string | undefined;

    while (matchedCount < target) {
      const scan = await this.publicationSource.fetchNextScanPage(
        sellerId,
        accessToken,
        scrollId,
      );
      if (scan.itemIds.length === 0) return { matches, reachedEnd: true };

      const items = await this.itemsService.getMany(scan.itemIds, accessToken);
      const candidates = this.cheapCandidates(
        scan.itemIds,
        items,
        seenItems,
        query,
      );
      for (
        let index = 0;
        index < candidates.length;
        index += PUBLICATION_REQUEST_CONCURRENCY
      ) {
        const batch = candidates.slice(
          index,
          index + PUBLICATION_REQUEST_CONCURRENCY,
        );
        const promotions = await Promise.all(
          batch.map((candidate) =>
            this.promotionsService.getPromotions(
              userId,
              candidate.itemId,
              accessToken,
            ),
          ),
        );
        for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
          const candidate = batch[batchIndex];
          const itemPromotions = promotions[batchIndex];
          if (!candidate || !itemPromotions) continue;
          const summary = summarizePromotions(itemPromotions);
          if (!matchesPromotionFilters(itemPromotions, summary, query))
            continue;
          matchedCount += 1;
          if (matchedCount > offset)
            matches.push({ candidate, promotions: itemPromotions, summary });
          if (matchedCount >= target) return { matches, reachedEnd: false };
        }
      }
      if (!scan.scrollId) return { matches, reachedEnd: true };
      scrollId = scan.scrollId;
    }
    return { matches, reachedEnd: false };
  }

  private cheapCandidates(
    itemIds: readonly string[],
    items: readonly MlItem[],
    seenItems: Set<string>,
    query: PromotionCatalogQuery,
  ) {
    const byId = new Map(items.map((item) => [item.id, item]));
    return itemIds.flatMap((itemId) => {
      if (seenItems.has(itemId)) return [];
      seenItems.add(itemId);
      const item = byId.get(itemId);
      const candidate = item ? toPromotionCandidate(item) : null;
      return candidate && matchesProductFilters(candidate, query)
        ? [candidate]
        : [];
    });
  }

  private toRow(
    match: PromotionCatalogMatch,
    categories: ReadonlyMap<
      string,
      PromotionCatalogRow['category']
    >,
  ): PromotionCatalogRow {
    const category = categories.get(match.candidate.categoryId);
    if (!category)
      throw new BadGatewayException('Mercado Libre no devolvió la categoría');
    return {
      itemId: match.candidate.itemId,
      familyId: match.candidate.familyId,
      title: match.candidate.title,
      thumbnail: match.candidate.thumbnail,
      category,
      price: match.candidate.price,
      publicationStatus: match.candidate.publicationStatus,
      attributes: match.candidate.attributes,
      promotions: match.promotions,
      promotionSummary: match.summary,
    };
  }
}
