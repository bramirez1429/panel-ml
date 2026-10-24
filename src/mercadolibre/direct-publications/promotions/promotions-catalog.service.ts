import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../../publications/publication.constants';
import { PublicationSourceService } from '../../publications/sync/publication-source.service';
import { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import { PublicationSearchService } from '../publications/publication-search.service';

import {
  currentPromotion,
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
    private readonly publicationSearchService: PublicationSearchService,
  ) {}

  async getCatalog(userId: string, query: PromotionCatalogQuery) {
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new BadRequestException('limit debe estar entre 1 y 20');
    if (query.search?.trim()) {
      return this.getSearchCatalog(userId, query, limit);
    }

    const offset = decodePromotionsCursor(query.cursor);
    if (offset === null)
      throw new BadRequestException('cursor de promociones inválido');
    const target = offset + limit;
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
    const publications = collected.matches.map((match) => this.toRow(match));
    const nextOffset = offset + publications.length;
    return {
      done: collected.reachedEnd,
      nextCursor: collected.reachedEnd
        ? null
        : encodePromotionsCursor(nextOffset),
      count: publications.length,
      publications,
    };
  }

  private async getSearchCatalog(
    userId: string,
    query: PromotionCatalogQuery,
    limit: number,
  ) {
    const search = await this.publicationSearchService.searchItems(
      userId,
      query.search,
      limit,
      query.cursor,
    );
    const candidates = search.items.flatMap((item) => {
      const candidate = toPromotionCandidate(item);
      return candidate &&
        matchesProductFilters(candidate, { ...query, search: undefined })
        ? [candidate]
        : [];
    });
    const matches = await this.loadPromotionMatches(
      userId,
      search.accessToken,
      candidates,
      query,
    );
    const publications = matches.map((match) => this.toRow(match));
    return {
      done: search.done,
      nextCursor: search.nextCursor,
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
  ): Promise<{ matches: PromotionCatalogMatch[]; reachedEnd: boolean }> {
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
        const batchMatches = await this.loadPromotionMatches(
          userId,
          accessToken,
          batch,
          query,
        );
        for (const match of batchMatches) {
          matchedCount += 1;
          if (matchedCount > offset) matches.push(match);
          if (matchedCount >= target) return { matches, reachedEnd: false };
        }
      }
      if (!scan.scrollId) return { matches, reachedEnd: true };
      scrollId = scan.scrollId;
    }
    return { matches, reachedEnd: false };
  }

  private async loadPromotionMatches(
    userId: string,
    accessToken: string,
    candidates: readonly PromotionCatalogMatch['candidate'][],
    query: PromotionCatalogQuery,
  ): Promise<PromotionCatalogMatch[]> {
    const matches: PromotionCatalogMatch[] = [];
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
        if (!matchesPromotionFilters(itemPromotions, summary, query)) continue;
        matches.push({ candidate, promotions: itemPromotions, summary });
      }
    }
    return matches;
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

  private toRow(match: PromotionCatalogMatch): PromotionCatalogRow {
    return {
      itemId: match.candidate.itemId,
      familyId: match.candidate.familyId,
      title: match.candidate.title,
      thumbnail: match.candidate.thumbnail,
      sku: match.candidate.sku,
      stock: match.candidate.stock,
      freeShipping: match.candidate.freeShipping,
      installmentLabel: match.candidate.installmentLabel,
      productGroup: match.candidate.productGroup,
      price: match.candidate.price,
      currentPromotion: currentPromotion(match.promotions),
      hasActivePromotion: match.promotions.active.length > 0,
      availablePromotionsCount: match.promotions.candidates.length,
      promotionStatus: match.summary.status,
    };
  }
}
