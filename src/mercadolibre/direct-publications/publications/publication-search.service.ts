import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
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
import { PublicationsSearchService } from './publications-search.service';

@Injectable()
export class PublicationSearchService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly itemsService: ItemsService,
    private readonly titleSearchService: PublicationTitleItemsSearchService,
    private readonly userProductFamilyService: UserProductFamilyService,
    private readonly publicationsSearchService: PublicationsSearchService,
    private readonly familiesService: FamiliesService,
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
    if (criteria.type === 'TITLE') this.validateLimit(limit);

    if (criteria.type === 'FAMILY') {
      try {
        return await this.searchFamily(criteria, userId);
      } catch (error: unknown) {
        if (!(error instanceof NotFoundException)) throw error;

        return this.tokenService.executeWithValidAccessToken(
          userId,
          ({ connection, accessToken }) =>
            Promise.resolve(
              this.complete(criteria, connection.seller_id, accessToken, []),
            ),
        );
      }
    }

    return this.tokenService.executeWithValidAccessToken(
      userId,
      async ({ connection, accessToken }) => {
        if (criteria.type === 'MLA') {
          let item: MlItem;
          try {
            item = await this.itemsService.getOne(criteria.value, accessToken);
          } catch (error: unknown) {
            if (error instanceof NotFoundException) {
              return this.complete(
                criteria,
                connection.seller_id,
                accessToken,
                [],
              );
            }
            throw error;
          }
          const items = this.belongsToSeller(item, connection.seller_id)
            ? [item]
            : [];
          return this.complete(
            criteria,
            connection.seller_id,
            accessToken,
            items,
          );
        }

        if (criteria.type === 'MLAU') {
          return this.searchUserProduct(
            criteria,
            connection.seller_id,
            accessToken,
          );
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
      },
    );
  }

  private async searchUserProduct(
    criteria: Extract<PublicationSearchCriteria, { type: 'MLAU' }>,
    sellerId: number,
    accessToken: string,
  ): Promise<PublicationItemsSearchResult> {
    let resolved: Awaited<
      ReturnType<UserProductFamilyService['resolveFamily']>
    >;
    try {
      resolved = await this.userProductFamilyService.resolveFamily(
        criteria.value,
        accessToken,
        this.userProductFamilyService.createCache(),
      );
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        return this.complete(criteria, sellerId, accessToken, []);
      }
      throw error;
    }
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
    userId: string,
  ): Promise<PublicationItemsSearchResult> {
    const { family, items, accessToken } =
      await this.familiesService.getFamilyItems(userId, criteria.value);
    const sellerId = Number(family.user_id);
    const sellerItems = items
      .filter((item) => this.belongsToSeller(item, sellerId))
      .map((item) => ({
        ...item,
        family_id: criteria.value,
      }));
    return this.complete(criteria, sellerId, accessToken, sellerItems);
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
