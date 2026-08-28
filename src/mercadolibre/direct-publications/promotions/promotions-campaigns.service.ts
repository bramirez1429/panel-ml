import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';

import type { PromotionCampaign } from './promotions-campaigns.types';
import type {
  PromotionCampaignItem,
  PromotionCampaignItemsPaging,
  PromotionCampaignItemsQuery,
} from './promotions-campaign-items.types';
import { PromotionsService } from './promotions.service';
import type {
  MlPromotion,
  MlPromotionCampaignItem,
  MlPromotionCampaignItemsResponse,
} from './promotions.types';

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

  async getCampaignItems(
    userId: string,
    promotionId: string,
    query: PromotionCampaignItemsQuery,
  ) {
    const id = requiredText(promotionId, 'promotionId es obligatorio');
    const promotionType = requiredText(
      query.promotionType,
      'promotionType es obligatorio',
    );
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const response = await this.promotionsService.getCampaignItems(
      userId,
      id,
      promotionType,
      accessToken,
      { limit: query.limit, offset: query.offset },
    );
    const paging = normalizePaging(response.paging);
    return {
      items: response.results.flatMap(toCampaignItem),
      ...(paging ? { paging } : {}),
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

function requiredText(value: unknown, message: string): string {
  const text = textOrNull(value);
  if (!text) throw new BadRequestException(message);
  return text;
}

function toCampaignItem(
  item: MlPromotionCampaignItem,
): PromotionCampaignItem[] {
  const itemId = textOrNull(item.id);
  if (!itemId) return [];
  const status = textOrNull(item.status);
  const price = finiteNumber(item.price);
  const promotionPrice = finiteNumber(item.promotion_price);
  return [
    {
      itemId,
      ...(status ? { status } : {}),
      ...(price !== null ? { price } : {}),
      ...(promotionPrice !== null ? { promotionPrice } : {}),
    },
  ];
}

function normalizePaging(
  paging: MlPromotionCampaignItemsResponse['paging'],
): PromotionCampaignItemsPaging | null {
  const total = finiteNumber(paging?.total);
  const offset = finiteNumber(paging?.offset);
  const limit = finiteNumber(paging?.limit);
  if (
    total === null ||
    offset === null ||
    limit === null ||
    total < 0 ||
    offset < 0 ||
    limit < 1
  )
    return null;
  return { total, offset, limit };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
