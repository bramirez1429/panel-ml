import { BadRequestException, Injectable } from '@nestjs/common';

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
  ): Promise<void> {
    switch (request.type) {
      case 'PRICE_DISCOUNT':
        if (publication.type === 'CLASSIC') {
          await this.priceDiscountService.createClassicPriceDiscount(
            userId,
            publication.itemId,
            request,
          );
        } else {
          await this.priceDiscountService.createNewPriceDiscount(
            userId,
            publication.familyId,
            publication.itemId,
            request,
          );
        }
        return;
      case 'DEAL':
        if (publication.type === 'CLASSIC') {
          await this.dealService.createClassic(
            userId,
            publication.itemId,
            request,
          );
        } else {
          await this.dealService.createNew(
            userId,
            publication.familyId,
            publication.itemId,
            request,
          );
        }
        return;
      case 'SELLER_CAMPAIGN':
        if (publication.type === 'CLASSIC') {
          await this.sellerCampaignService.createClassic(
            userId,
            publication.itemId,
            request,
          );
        } else {
          await this.sellerCampaignService.createNew(
            userId,
            publication.familyId,
            publication.itemId,
            request,
          );
        }
        return;
      case 'SMART':
        if (publication.type === 'CLASSIC') {
          await this.smartPromotionService.createClassic(
            userId,
            publication.itemId,
            request,
          );
        } else {
          await this.smartPromotionService.createNew(
            userId,
            publication.familyId,
            publication.itemId,
            request,
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
