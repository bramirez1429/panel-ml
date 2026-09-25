import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';

import { ItemsService } from '../items/items.service';
import { PublicationsSearchService } from './publications-search.service';
import { PublicationsMapper } from './publications.mapper';
import { PublicationsReadSource } from './publications-read-source';

@Injectable()
export class PublicationsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly searchService: PublicationsSearchService,
    private readonly itemsService: ItemsService,
    private readonly readSource: PublicationsReadSource,
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
    return this.readSource.getGrouped(userId, limit, cursor, search);
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
