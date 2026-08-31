import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { FamiliesService } from '../families/families.service';
import { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import { parsePublicationSearchCriteria } from './publication-search-criteria';
import { PublicationSearchMapper } from './publication-search.mapper';
import type {
  PublicationItemsSearchResult,
  PublicationSearchCriteria,
  PublicationSearchResult,
} from './publication-search.types';
import { PublicationTitleItemsSearchService } from './publication-title-items-search.service';

@Injectable()
export class PublicationSearchService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly familiesService: FamiliesService,
    private readonly itemsService: ItemsService,
    private readonly titleSearchService: PublicationTitleItemsSearchService,
  ) {}

  async search(
    userId: string,
    query: unknown,
    limit = 20,
    cursor?: string,
  ): Promise<PublicationSearchResult> {
    const result = await this.searchItems(userId, query, limit, cursor);
    const items = result.items.map((item) =>
      PublicationSearchMapper.toResult(
        item,
        result.criteria.type === 'FAMILY' ? result.criteria.value : undefined,
      ),
    );
    return {
      criteria: result.criteria,
      done: result.done,
      nextCursor: result.nextCursor,
      itemsCount: items.length,
      items,
    };
  }

  async searchItems(
    userId: string,
    query: unknown,
    limit = 20,
    cursor?: string,
  ): Promise<PublicationItemsSearchResult> {
    const criteria = parsePublicationSearchCriteria(query);

    if (criteria.type === 'FAMILY') {
      return this.searchFamily(userId, criteria);
    }
    if (criteria.type === 'TITLE') this.validateLimit(limit);

    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );

    if (criteria.type === 'MLA') {
      const item = await this.itemsService.getOne(criteria.value, accessToken);
      const items = this.belongsToSeller(item, connection.seller_id)
        ? [item]
        : [];
      return this.complete(criteria, connection.seller_id, accessToken, items);
    }

    const result = await this.titleSearchService.search(
      connection.seller_id,
      accessToken,
      criteria.value,
      limit,
      cursor,
    );
    return {
      criteria,
      done: result.done,
      nextCursor: result.nextCursor,
      sellerId: connection.seller_id,
      accessToken,
      items: result.items,
    };
  }

  private async searchFamily(
    userId: string,
    criteria: Extract<PublicationSearchCriteria, { type: 'FAMILY' }>,
  ): Promise<PublicationItemsSearchResult> {
    const result = await this.familiesService.getFamilyItems(
      userId,
      criteria.value,
    );
    return this.complete(
      criteria,
      Number(result.family.user_id),
      result.accessToken,
      result.items.map((item) => ({
        ...item,
        family_id: criteria.value,
      })),
    );
  }

  private complete(
    criteria: PublicationSearchCriteria,
    sellerId: number,
    accessToken: string,
    items: MlItem[],
  ): PublicationItemsSearchResult {
    return {
      criteria,
      done: true,
      nextCursor: null,
      sellerId,
      accessToken,
      items,
    };
  }

  private belongsToSeller(item: MlItem, sellerId: number): boolean {
    return (
      item.seller_id === undefined ||
      String(item.seller_id) === String(sellerId)
    );
  }

  private validateLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new BadRequestException('limit debe estar entre 1 y 20');
    }
  }
}
