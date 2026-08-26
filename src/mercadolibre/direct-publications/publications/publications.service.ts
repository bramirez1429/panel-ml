import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';

import { ItemsService } from '../items/items.service';
import { FamiliesService } from '../families/families.service';
import { PublicationsSearchService } from './publications-search.service';
import { PublicationsMapper } from './publications.mapper';
import { PublicationsGlobalSearchService } from './publications-global-search.service';
import { hasTitleSearch } from './publication-title-search.helpers';

@Injectable()
export class PublicationsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly searchService: PublicationsSearchService,
    private readonly itemsService: ItemsService,
    private readonly familiesService: FamiliesService,
    private readonly globalSearchService: PublicationsGlobalSearchService,
  ) {}

  /** Listado directo sin agrupar. */
  async getPage(userId: string, limit = 20, offset = 0) {
    this.validatePage(limit, offset);

    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );

    const search = await this.searchService.searchPage(
      connection.seller_id,
      accessToken,
      limit,
      offset,
    );

    const items = await this.itemsService.getMany(search.results, accessToken);

    return {
      paging: search.paging,
      count: items.length,
      publications: items.map((item) =>
        PublicationsMapper.toDirectPublication(item),
      ),
    };
  }

  /** Listado agrupado para el frontend. */
  async getGrouped(
    userId: string,
    limit = 20,
    cursor?: string,
    search?: string,
  ) {
    this.validateLimit(limit);

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

    if (!ids.length) {
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

    const familyIds = PublicationsMapper.getFamilyIds(items);

    const families = [];

    for (const familyId of familyIds) {
      families.push(await this.familiesService.getSummary(userId, familyId));
    }

    return {
      done: false,
      nextCursor: scan.scroll_id ?? cursor ?? null,
      rawItemsCount: items.length,
      productsCount: shared.length + families.length,
      products: [...shared, ...families],
    };
  }

  private validateLimit(limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new BadRequestException('limit debe estar entre 1 y 20');
    }
  }

  private validatePage(limit: number, offset: number) {
    this.validateLimit(limit);

    if (!Number.isInteger(offset) || offset < 0) {
      throw new BadRequestException('offset inválido');
    }
  }
}
