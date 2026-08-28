import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';

import type { PromotionCampaign } from './promotions-campaigns.types';
import { PromotionsService } from './promotions.service';
import type { MlPromotion } from './promotions.types';

@Injectable()
export class PromotionsCampaignsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly promotionsService: PromotionsService,
  ) {}

  async getCampaigns(userId: string) {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    return {
      campaigns: (
        await this.promotionsService.getSellerCampaigns(
          userId,
          connection.seller_id,
          accessToken,
        )
      )
        .map(toCampaign)
        .filter((campaign): campaign is PromotionCampaign => campaign !== null),
    };
  }
}

function toCampaign(promotion: MlPromotion): PromotionCampaign | null {
  const id = textOrNull(promotion.id);
  const type = textOrNull(promotion.type);
  const status = textOrNull(promotion.status);
  if (!id || !type || (status !== 'started' && status !== 'pending'))
    return null;
  return {
    id,
    name: textOrNull(promotion.name),
    type,
    status,
    startDate: textOrNull(promotion.start_date),
    finishDate: textOrNull(promotion.finish_date),
    deadlineDate: textOrNull(promotion.deadline_date),
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
