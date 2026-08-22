import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type { MlItem } from '../items/items.types';
import type { DealUpdate } from './deal.types';

@Injectable()
export class DealService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,

    private readonly apiService: MercadolibreApiService,

    private readonly itemsService: ItemsService,
  ) {}

  async createClassic(userId: string, itemId: string, changes: DealUpdate) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateClassic(item);

    return this.createDeal(item.id, changes, accessToken);
  }

  async updateClassic(userId: string, itemId: string, changes: DealUpdate) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateClassic(item);

    return this.updateDeal(item.id, changes, accessToken);
  }

  async deleteClassic(userId: string, itemId: string, promotionId: string) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateClassic(item);

    return this.deleteDeal(item.id, promotionId, accessToken);
  }

  async createNew(
    userId: string,
    familyId: string,
    itemId: string,
    changes: DealUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNew(familyId, item);

    return this.createDeal(item.id, changes, accessToken);
  }

  async updateNew(
    userId: string,
    familyId: string,
    itemId: string,
    changes: DealUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNew(familyId, item);

    return this.updateDeal(item.id, changes, accessToken);
  }

  async deleteNew(
    userId: string,
    familyId: string,
    itemId: string,
    promotionId: string,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNew(familyId, item);

    return this.deleteDeal(item.id, promotionId, accessToken);
  }

  private createDeal(itemId: string, changes: DealUpdate, accessToken: string) {
    this.validateChanges(changes);

    return this.apiService.post(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      this.buildBody(changes),
      accessToken,
    );
  }

  private updateDeal(itemId: string, changes: DealUpdate, accessToken: string) {
    this.validateChanges(changes);

    return this.apiService.put(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      this.buildBody(changes),
      accessToken,
    );
  }

  private deleteDeal(itemId: string, promotionId: string, accessToken: string) {
    this.validatePromotionId(promotionId);

    return this.apiService.delete(
      `/seller-promotions/items/${itemId}` +
        `?promotion_type=DEAL` +
        `&promotion_id=${encodeURIComponent(promotionId)}` +
        `&app_version=v2`,
      accessToken,
    );
  }

  private buildBody(changes: DealUpdate) {
    return {
      promotion_id: changes.promotionId,

      promotion_type: 'DEAL',

      deal_price: changes.dealPrice,

      ...(changes.topDealPrice !== undefined
        ? {
            top_deal_price: changes.topDealPrice,
          }
        : {}),
    };
  }

  private validateChanges(changes: DealUpdate): void {
    this.validatePromotionId(changes?.promotionId);

    if (!Number.isFinite(changes?.dealPrice) || changes.dealPrice <= 0) {
      throw new BadRequestException('dealPrice debe ser mayor a 0');
    }

    if (
      changes.topDealPrice !== undefined &&
      (!Number.isFinite(changes.topDealPrice) || changes.topDealPrice <= 0)
    ) {
      throw new BadRequestException('topDealPrice debe ser mayor a 0');
    }
  }

  private validatePromotionId(promotionId: string): void {
    if (typeof promotionId !== 'string' || !promotionId.trim()) {
      throw new BadRequestException('promotionId es obligatorio');
    }
  }

  private validateClassic(item: MlItem): void {
    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
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
