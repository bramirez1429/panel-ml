import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';
import type { MlItem } from '../items/items.types';

import { DealService } from './deal.service';
import { PriceDiscountService } from './price-discount.service';
import { promotionError } from './promotion-errors';
import type { PromotionPublication } from './promotion-publication.types';
import { PromotionsService } from './promotions.service';
import type { ManagedActivePromotion } from './promotion-manager.types';
import { SellerCampaignService } from './seller-campaign.service';
import { SmartPromotionService } from './smart-promotion.service';

@Injectable()
export class PromotionRemovalService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly itemsService: ItemsService,
    private readonly promotionsService: PromotionsService,
    private readonly apiService: MercadolibreApiService,
    private readonly priceDiscountService: PriceDiscountService,
    private readonly dealService: DealService,
    private readonly sellerCampaignService: SellerCampaignService,
    private readonly smartPromotionService: SmartPromotionService,
  ) {}

  async removeAll(userId: string, itemId: string) {
    try {
      const token = await this.tokenService.getValidAccessToken(userId);
      const item = await this.itemsService.getOne(itemId, token);
      const publication = this.publicationOf(item);
      const current = await this.promotionsService.getPromotionsStrict(
        userId,
        itemId,
        token,
      );
      for (const promotion of current.active) {
        await this.removePromotion(userId, publication, promotion);
      }
      await this.verifyNoActive(userId, itemId);
      return { success: true, itemId, activePromotion: null };
    } catch (error) {
      if (isPromotionException(error)) throw error;
      throw promotionError(
        'PROMOTION_REMOVAL_FAILED',
        'No se pudo desactivar la promoción',
      );
    }
  }

  async removePromotion(
    userId: string,
    publication: PromotionPublication,
    promotion: ManagedActivePromotion,
  ): Promise<void> {
    switch (promotion.type) {
      case 'PRICE_DISCOUNT':
        if (publication.type === 'CLASSIC')
          await this.priceDiscountService.deleteClassicPriceDiscount(
            userId,
            publication.itemId,
          );
        else
          await this.priceDiscountService.deleteNewPriceDiscount(
            userId,
            publication.familyId,
            publication.itemId,
          );
        return;
      case 'DEAL':
        await this.removeDeal(userId, publication, promotion);
        return;
      case 'SELLER_CAMPAIGN':
        await this.removeCampaign(userId, publication, promotion);
        return;
      case 'SMART':
        await this.removeSmart(userId, publication, promotion);
        return;
      default:
        await this.deleteAllOffers(userId, publication.itemId);
    }
  }

  async verifyNoActive(userId: string, itemId: string): Promise<void> {
    try {
      const token = await this.tokenService.getValidAccessToken(userId);
      await this.verifyRemoved(userId, itemId, token);
    } catch (error) {
      if (isPromotionException(error)) throw error;
      throw promotionError(
        'PROMOTION_VERIFICATION_FAILED',
        'Mercado Libre no confirmó la eliminación de la promoción',
      );
    }
  }

  private async removeDeal(
    userId: string,
    publication: PromotionPublication,
    promotion: ManagedActivePromotion,
  ) {
    const promotionId = this.requireId(promotion);
    if (publication.type === 'CLASSIC')
      await this.dealService.deleteClassic(
        userId,
        publication.itemId,
        promotionId,
      );
    else
      await this.dealService.deleteNew(
        userId,
        publication.familyId,
        publication.itemId,
        promotionId,
      );
  }

  private async removeCampaign(
    userId: string,
    publication: PromotionPublication,
    promotion: ManagedActivePromotion,
  ) {
    const promotionId = this.requireId(promotion);
    if (publication.type === 'CLASSIC')
      await this.sellerCampaignService.deleteClassic(
        userId,
        publication.itemId,
        promotionId,
      );
    else
      await this.sellerCampaignService.deleteNew(
        userId,
        publication.familyId,
        publication.itemId,
        promotionId,
      );
  }

  private async removeSmart(
    userId: string,
    publication: PromotionPublication,
    promotion: ManagedActivePromotion,
  ) {
    const promotionId = this.requireId(promotion);
    const offerId = this.requireOfferId(promotion);
    if (publication.type === 'CLASSIC')
      await this.smartPromotionService.deleteClassic(
        userId,
        publication.itemId,
        promotionId,
        offerId,
      );
    else
      await this.smartPromotionService.deleteNew(
        userId,
        publication.familyId,
        publication.itemId,
        promotionId,
        offerId,
      );
  }

  private async deleteAllOffers(userId: string, itemId: string): Promise<void> {
    const token = await this.tokenService.getValidAccessToken(userId);
    await this.apiService.delete(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      token,
    );
  }

  private async verifyRemoved(
    userId: string,
    itemId: string,
    token: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = await this.promotionsService.getPromotionsStrict(
        userId,
        itemId,
        token,
      );
      if (current.active.length === 0) return;
      if (attempt < 9) await delay(300);
    }
    throw promotionError(
      'PROMOTION_VERIFICATION_FAILED',
      'Mercado Libre no confirmó la desactivación',
    );
  }

  private publicationOf(item: MlItem): PromotionPublication {
    if (
      PublicationsMapper.getModel(item) === 'VARIANT_PRICING' &&
      item.family_id !== null &&
      item.family_id !== undefined
    ) {
      return { type: 'NEW', itemId: item.id, familyId: String(item.family_id) };
    }
    return { type: 'CLASSIC', itemId: item.id };
  }

  private requireId(promotion: ManagedActivePromotion): string {
    if (typeof promotion.id !== 'string' || !promotion.id.trim())
      throw promotionError(
        'PROMOTION_REMOVAL_FAILED',
        'Promoción sin identificador',
      );
    return promotion.id;
  }

  private requireOfferId(promotion: ManagedActivePromotion): string {
    if (typeof promotion.ref_id !== 'string' || !promotion.ref_id.trim())
      throw promotionError(
        'PROMOTION_REMOVAL_FAILED',
        'Oferta sin identificador',
      );
    return promotion.ref_id;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPromotionException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { getResponse?: () => unknown };
  const response =
    typeof value.getResponse === 'function' ? value.getResponse() : null;
  return (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    typeof response.code === 'string' &&
    response.code.startsWith('PROMOTION_')
  );
}
