import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import {
  MercadolibreApiService,
  type MercadolibreApiRequestOptions,
} from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type { MlItem } from '../items/items.types';
import type { SellerCampaignUpdate } from './seller-campaign.types';

@Injectable()
export class SellerCampaignService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,

    private readonly apiService: MercadolibreApiService,

    private readonly itemsService: ItemsService,
  ) {}

  async createClassic(
    userId: string,
    itemId: string,
    changes: SellerCampaignUpdate,
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

  async updateClassic(
    userId: string,
    itemId: string,
    changes: SellerCampaignUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateClassic(item);

    return this.update(item.id, changes, accessToken);
  }

  async deleteClassic(
    userId: string,
    itemId: string,
    promotionId: string,
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

    return this.remove(item.id, promotionId, accessToken, options);
  }

  async createNew(
    userId: string,
    familyId: string,
    itemId: string,
    changes: SellerCampaignUpdate,
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

  async updateNew(
    userId: string,
    familyId: string,
    itemId: string,
    changes: SellerCampaignUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNew(familyId, item);

    return this.update(item.id, changes, accessToken);
  }

  async deleteNew(
    userId: string,
    familyId: string,
    itemId: string,
    promotionId: string,
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

    return this.remove(item.id, promotionId, accessToken, options);
  }

  private create(
    itemId: string,
    changes: SellerCampaignUpdate,
    accessToken: string,
    options?: MercadolibreApiRequestOptions,
  ) {
    this.validateChanges(changes);

    return this.apiService.post(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      {
        promotion_id: changes.promotionId,

        promotion_type: 'SELLER_CAMPAIGN',

        deal_price: changes.dealPrice,
      },
      accessToken,
      'promotion',
      options,
    );
  }

  private update(
    itemId: string,
    changes: SellerCampaignUpdate,
    accessToken: string,
  ) {
    this.validateChanges(changes);

    return this.apiService.put(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      {
        promotion_id: changes.promotionId,

        promotion_type: 'SELLER_CAMPAIGN',

        deal_price: changes.dealPrice,
      },
      accessToken,
    );
  }

  private remove(
    itemId: string,
    promotionId: string,
    accessToken: string,
    options?: MercadolibreApiRequestOptions,
  ) {
    this.validatePromotionId(promotionId);

    return this.apiService.delete(
      `/seller-promotions/items/${itemId}` +
        `?promotion_type=SELLER_CAMPAIGN` +
        `&promotion_id=${encodeURIComponent(promotionId)}` +
        `&app_version=v2`,
      accessToken,
      'promotion',
      options,
    );
  }

  private validateChanges(changes: SellerCampaignUpdate): void {
    this.validatePromotionId(changes?.promotionId);

    if (!Number.isFinite(changes?.dealPrice) || changes.dealPrice <= 0) {
      throw new BadRequestException('dealPrice debe ser mayor a 0');
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
  }
}
