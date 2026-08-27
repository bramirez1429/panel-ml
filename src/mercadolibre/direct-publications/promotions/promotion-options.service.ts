import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { ItemsService } from '../items/items.service';

import {
  normalizePromotion,
  toPromotionCandidate,
} from './promotions-catalog.helpers';
import type { PromotionOption } from './promotions-catalog.types';
import {
  MercadoLibreSellingFeeService,
  type SellingFeeRequest,
} from './mercadolibre-selling-fee.service';
import { promotionError } from './promotion-errors';
import { PromotionsService } from './promotions.service';

const SUPPORTED_TYPES = new Set([
  'PRICE_DISCOUNT',
  'DEAL',
  'SELLER_CAMPAIGN',
  'SMART',
]);

@Injectable()
export class PromotionOptionsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly itemsService: ItemsService,
    private readonly promotionsService: PromotionsService,
    private readonly sellingFeeService: MercadoLibreSellingFeeService,
  ) {}

  async getOptions(userId: string, itemId: string): Promise<PromotionOption[]> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const item = await this.itemsService.getOne(itemId, accessToken);
    const candidate = toPromotionCandidate(item);
    if (!candidate) {
      throw promotionError(
        'PROMOTION_NOT_FOUND',
        'No se encontró una publicación promocionable',
      );
    }
    const promotions = await this.promotionsService.getPromotions(
      userId,
      itemId,
      accessToken,
    );
    const requests: SellingFeeRequest[] = promotions.candidates.map(
      (promotion) => ({
        candidate,
        effectivePrice: promotion.price ?? candidate.price,
      }),
    );
    const estimates = await this.sellingFeeService.getMany(
      requests,
      accessToken,
    );
    return promotions.candidates.map((promotion, index) => ({
      ...normalizePromotion(promotion),
      canApply: SUPPORTED_TYPES.has(promotion.type?.toUpperCase() ?? ''),
      saleEstimate: estimates[index] ?? null,
    }));
  }
}
