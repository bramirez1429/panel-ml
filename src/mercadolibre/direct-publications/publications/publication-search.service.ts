import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
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
import { PublicationsSearchService } from './publications-search.service';

@Injectable()
export class PublicationSearchService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly itemsService: ItemsService,
    private readonly titleSearchService: PublicationTitleItemsSearchService,
    private readonly userProductFamilyService: UserProductFamilyService,
    private readonly publicationsSearchService: PublicationsSearchService,
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
    _userId: string,
    query: unknown,
    limit = 20,
    cursor?: string,
  ): Promise<PublicationItemsSearchResult> {
    const criteria = parsePublicationSearchCriteria(query);
    if (criteria.type === 'TITLE') this.validateLimit(limit);

    const connection = await this.tokenService.getSharedStoredConnection();
    const accessToken =
      await this.tokenService.getSharedValidAccessToken(connection);

    if (criteria.type === 'MLA') {
      const item = await this.itemsService.getOne(criteria.value, accessToken);
      const items = this.belongsToSeller(item, connection.seller_id)
        ? [item]
        : [];
      return this.complete(criteria, connection.seller_id, accessToken, items);
    }

    if (criteria.type === 'MLAU') {
      return this.searchUserProduct(
        criteria,
        connection.seller_id,
        accessToken,
      );
    }

    if (criteria.type === 'FAMILY') {
      return this.searchFamily(criteria, connection.seller_id, accessToken);
    }

    const result = await this.titleSearchService.search(
      connection.seller_id,
      accessToken,
      criteria.value,
      Math.min(limit, 4),
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

  private async searchUserProduct(
    criteria: Extract<PublicationSearchCriteria, { type: 'MLAU' }>,
    sellerId: number,
    accessToken: string,
  ): Promise<PublicationItemsSearchResult> {
    const resolved = await this.userProductFamilyService.resolveFamily(
      criteria.value,
      accessToken,
      this.userProductFamilyService.createCache(),
    );
    if (String(resolved.userId) !== String(sellerId)) {
      return this.complete(criteria, sellerId, accessToken, []);
    }

    const itemIds = await this.publicationsSearchService.searchByUserProductIds(
      sellerId,
      [criteria.value],
      accessToken,
    );
    const items = (await this.itemsService.getMany(itemIds, accessToken))
      .filter((item) => this.belongsToSeller(item, sellerId))
      .map((item) => ({
        ...item,
        family_id: resolved.familyId,
        user_product_id: criteria.value,
      }));
    return this.complete(criteria, sellerId, accessToken, items);
  }

  private async searchFamily(
    criteria: Extract<PublicationSearchCriteria, { type: 'FAMILY' }>,
    sellerId: number,
    accessToken: string,
  ): Promise<PublicationItemsSearchResult> {
    const family = await this.userProductFamilyService.getFamily(
      criteria.value,
      accessToken,
      this.userProductFamilyService.createCache(),
    );
    if (String(family.userId) !== String(sellerId)) {
      return this.complete(criteria, sellerId, accessToken, []);
    }

    const itemIds = await this.publicationsSearchService.searchByUserProductIds(
      sellerId,
      family.userProductIds,
      accessToken,
    );
    const items = (await this.itemsService.getMany(itemIds, accessToken))
      .filter((item) => this.belongsToSeller(item, sellerId))
      .map((item) => ({
        ...item,
        family_id: criteria.value,
      }));
    return this.complete(criteria, sellerId, accessToken, items);
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
    return String(item.seller_id) === String(sellerId);
  }

  private validateLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new BadRequestException('limit debe estar entre 1 y 20');
    }
  }
}
