import { BadRequestException, Injectable } from '@nestjs/common';

import type { MercadolibreApiRequestOptions } from '../../shared/mercadolibre-api.service';

import { DealService } from './deal.service';
import { PriceDiscountService } from './price-discount.service';
import type { PromotionPublication } from './promotion-publication.types';
import { SellerCampaignService } from './seller-campaign.service';
import type { PromotionSwitchRequest } from './promotion-manager.types';
import { SmartPromotionService } from './smart-promotion.service';

@Injectable()
export class PromotionApplicationService {
  constructor(
    private readonly priceDiscountService: PriceDiscountService,
    private readonly dealService: DealService,
    private readonly sellerCampaignService: SellerCampaignService,
    private readonly smartPromotionService: SmartPromotionService,
  ) {}

  async apply(
    userId: string,
    publication: PromotionPublication,
    request: PromotionSwitchRequest,
    options?: MercadolibreApiRequestOptions,
  ): Promise<void> {
    switch (request.type) {
      case 'PRICE_DISCOUNT':
        if (publication.type === 'CLASSIC') {
          await this.priceDiscountService.createClassicPriceDiscount(
            userId,
            publication.itemId,
            request,
            options,
          );
        } else {
          await this.priceDiscountService.createNewPriceDiscount(
            userId,
            publication.familyId,
            publication.itemId,
            request,
            options,
          );
        }
        return;
      case 'DEAL':
        if (publication.type === 'CLASSIC') {
          await this.dealService.createClassic(
            userId,
            publication.itemId,
            request,
            options,
          );
        } else {
          await this.dealService.createNew(
            userId,
            publication.familyId,
            publication.itemId,
            request,
            options,
          );
        }
        return;
      case 'SELLER_CAMPAIGN':
        if (publication.type === 'CLASSIC') {
          await this.sellerCampaignService.createClassic(
            userId,
            publication.itemId,
            request,
            options,
          );
        } else {
          await this.sellerCampaignService.createNew(
            userId,
            publication.familyId,
            publication.itemId,
            request,
            options,
          );
        }
        return;
      case 'SMART':
        if (publication.type === 'CLASSIC') {
          await this.smartPromotionService.createClassic(
            userId,
            publication.itemId,
            request,
            options,
          );
        } else {
          await this.smartPromotionService.createNew(
            userId,
            publication.familyId,
            publication.itemId,
            request,
            options,
          );
        }
        return;
      default: {
        const exhaustiveCheck: never = request;
        throw new BadRequestException(
          `Tipo de promociÃ³n no soportado: ${String(exhaustiveCheck)}`,
        );
      }
    }
  }
}
