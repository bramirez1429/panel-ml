import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type { MlItem } from '../items/items.types';

import type {
  MlPromotionPriceResponse,
  PriceDiscountUpdate,
} from './price-discount.types';

@Injectable()
export class PriceDiscountService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,

    private readonly apiService: MercadolibreApiService,

    private readonly itemsService: ItemsService,
  ) {}

  async createClassicPriceDiscount(
    itemId: string,
    changes: PriceDiscountUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return this.createPriceDiscount(item.id, changes, accessToken);
  }

  async deleteClassicPriceDiscount(itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return this.deletePriceDiscount(item.id, accessToken);
  }

  async createNewPriceDiscount(
    familyId: string,
    itemId: string,
    changes: PriceDiscountUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNew(familyId, item);

    return this.createPriceDiscount(item.id, changes, accessToken);
  }

  async deleteNewPriceDiscount(familyId: string, itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNew(familyId, item);

    return this.deletePriceDiscount(item.id, accessToken);
  }

  private createPriceDiscount(
    itemId: string,
    changes: PriceDiscountUpdate,
    accessToken: string,
  ) {
    this.validateChanges(changes);

    return this.apiService.post<MlPromotionPriceResponse>(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      {
        deal_price: changes.dealPrice,

        ...(changes.topDealPrice !== undefined
          ? {
              top_deal_price: changes.topDealPrice,
            }
          : {}),

        start_date: changes.startDate,

        finish_date: changes.finishDate,

        promotion_type: 'PRICE_DISCOUNT',
      },
      accessToken,
    );
  }

  private deletePriceDiscount(itemId: string, accessToken: string) {
    return this.apiService.delete<unknown>(
      `/seller-promotions/items/${itemId}` +
        '?promotion_type=PRICE_DISCOUNT' +
        '&app_version=v2',
      accessToken,
    );
  }

  private validateChanges(changes: PriceDiscountUpdate): void {
    if (!Number.isFinite(changes?.dealPrice) || changes.dealPrice <= 0) {
      throw new BadRequestException('dealPrice debe ser mayor a 0');
    }

    if (
      changes.topDealPrice !== undefined &&
      (!Number.isFinite(changes.topDealPrice) || changes.topDealPrice <= 0)
    ) {
      throw new BadRequestException('topDealPrice debe ser mayor a 0');
    }

    if (!changes.startDate || Number.isNaN(Date.parse(changes.startDate))) {
      throw new BadRequestException('startDate inválido');
    }

    if (!changes.finishDate || Number.isNaN(Date.parse(changes.finishDate))) {
      throw new BadRequestException('finishDate inválido');
    }

    if (
      new Date(changes.finishDate).getTime() <
      new Date(changes.startDate).getTime()
    ) {
      throw new BadRequestException(
        'finishDate debe ser posterior a startDate',
      );
    }
  }

  private validateNew(familyId: string, item: MlItem): void {
    if (PublicationsMapper.getModel(item) !== 'VARIANT_PRICING') {
      throw new BadRequestException('La publicación no es versión nueva');
    }

    if (String(item.family_id ?? '') !== familyId) {
      throw new BadRequestException(
        'El MLA no pertenece a la familia indicada',
      );
    }

    if (!item.user_product_id) {
      throw new BadRequestException('La publicación no tiene userProductId');
    }
  }
}
