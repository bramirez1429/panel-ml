import { Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { FamiliesService } from '../families/families.service';
import { ItemsService } from '../items/items.service';
import { hasTitleSearch } from './publication-title-search.helpers';
import { PublicationsGlobalSearchService } from './publications-global-search.service';
import { PublicationsMapper } from './publications.mapper';
import { PublicationsReadSource } from './publications-read-source';
import { PublicationsSearchService } from './publications-search.service';

@Injectable()
export class MercadoLibrePublicationsReadSource extends PublicationsReadSource {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly searchService: PublicationsSearchService,
    private readonly itemsService: ItemsService,
    private readonly familiesService: FamiliesService,
    private readonly globalSearchService: PublicationsGlobalSearchService,
  ) {
    super();
  }

  async getGrouped(
    userId: string,
    limit: number,
    cursor?: string,
    search?: string,
  ) {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );

    if (hasTitleSearch(search)) {
      return this.globalSearchService.search(
        userId,
        connection.seller_id,
        accessToken,
        search,
        limit,
        cursor,
      );
    }

    const scan = await this.searchService.scanPage(
      connection.seller_id,
      accessToken,
      limit,
      cursor,
    );
    const ids = scan.results ?? [];
    if (ids.length === 0) {
      return {
        done: true,
        nextCursor: null,
        rawItemsCount: 0,
        productsCount: 0,
        products: [],
      };
    }

    const items = await this.itemsService.getMany(ids, accessToken);
    const shared = items
      .filter((item) => PublicationsMapper.getModel(item) === 'SHARED')
      .map((item) => PublicationsMapper.toSharedProduct(item));
    const families = [];
    for (const familyId of PublicationsMapper.getFamilyIds(items)) {
      families.push(
        await this.familiesService.getListingSummary(userId, familyId),
      );
    }

    return {
      done: false,
      nextCursor: scan.scroll_id ?? cursor ?? null,
      rawItemsCount: items.length,
      productsCount: shared.length + families.length,
      products: [...shared, ...families],
    };
  }
}
