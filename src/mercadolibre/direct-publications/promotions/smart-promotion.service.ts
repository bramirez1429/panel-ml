import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import {
  MercadolibreApiService,
  type MercadolibreApiRequestOptions,
} from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type { MlItem } from '../items/items.types';
import type { SmartPromotionUpdate } from './smart-promotion.types';

@Injectable()
export class SmartPromotionService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,

    private readonly apiService: MercadolibreApiService,

    private readonly itemsService: ItemsService,
  ) {}

  async createClassic(
    userId: string,
    itemId: string,
    changes: SmartPromotionUpdate,
    options?: MercadolibreApiRequestOptions,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
      'promotion',
      options,
    );

    this.validateClassic(item);

    return this.create(item.id, changes, accessToken, options);
  }

  async deleteClassic(
    userId: string,
    itemId: string,
    promotionId: string,
    offerId: string,
    options?: MercadolibreApiRequestOptions,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
      'promotion',
      options,
    );

    this.validateClassic(item);

    return this.remove(item.id, promotionId, offerId, accessToken, options);
  }

  async createNew(
    userId: string,
    familyId: string,
    itemId: string,
    changes: SmartPromotionUpdate,
    options?: MercadolibreApiRequestOptions,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
      'promotion',
      options,
    );

    this.validateNew(familyId, item);

    return this.create(item.id, changes, accessToken, options);
  }

  async deleteNew(
    userId: string,
    familyId: string,
    itemId: string,
    promotionId: string,
    offerId: string,
    options?: MercadolibreApiRequestOptions,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
      'promotion',
      options,
    );

    this.validateNew(familyId, item);

    return this.remove(item.id, promotionId, offerId, accessToken, options);
  }

  private create(
    itemId: string,
    changes: SmartPromotionUpdate,
    accessToken: string,
    options?: MercadolibreApiRequestOptions,
  ) {
    this.validateChanges(changes);

    return this.apiService.post(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      {
        promotion_id: changes.promotionId,

        promotion_type: 'SMART',

        offer_id: changes.offerId,
      },
      accessToken,
      'promotion',
      options,
    );
  }

  private remove(
    itemId: string,
    promotionId: string,
    offerId: string,
    accessToken: string,
    options?: MercadolibreApiRequestOptions,
  ) {
    this.validatePromotionId(promotionId);

    this.validateOfferId(offerId);

    return this.apiService.delete(
      `/seller-promotions/items/${itemId}` +
        `?promotion_type=SMART` +
        `&promotion_id=${encodeURIComponent(promotionId)}` +
        `&offer_id=${encodeURIComponent(offerId)}` +
        `&app_version=v2`,
      accessToken,
      'promotion',
      options,
    );
  }

  private validateChanges(changes: SmartPromotionUpdate): void {
    this.validatePromotionId(changes?.promotionId);

    this.validateOfferId(changes?.offerId);
  }

  private validatePromotionId(promotionId: string): void {
    if (typeof promotionId !== 'string' || !promotionId.trim()) {
      throw new BadRequestException('promotionId es obligatorio');
    }
  }

  private validateOfferId(offerId: string): void {
    if (typeof offerId !== 'string' || !offerId.trim()) {
      throw new BadRequestException('offerId es obligatorio');
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
  }
}
