import { Injectable } from '@nestjs/common';

import {
  MercadolibreApiService,
  type MercadolibreApiRequestOptions,
} from '../../shared/mercadolibre-api.service';

import { MlPromotion, type MlPromotions } from './promotions.types';

@Injectable()
export class PromotionsService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  /** Obtiene todas las promociones de un MLA. */
  async getPromotions(
    userId: string,
    itemId: string,
    accessToken: string,
  ): Promise<MlPromotions> {
    void userId;
    const promotions = await this.safeGet<MlPromotion[]>(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      accessToken,
      [],
    );

    return this.groupPromotions(promotions);
  }

  async getPromotionsStrict(
    userId: string,
    itemId: string,
    accessToken: string,
    options?: MercadolibreApiRequestOptions,
  ): Promise<MlPromotions> {
    void userId;
    const promotions = await this.apiService.get<MlPromotion[]>(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      accessToken,
      'promotion',
      options,
    );
    return this.groupPromotions(promotions);
  }

  /** Obtiene las campaÃ±as disponibles globalmente para un seller. */
  async getSellerCampaigns(
    userId: string,
    sellerId: number,
    accessToken: string,
  ): Promise<MlPromotion[]> {
    void userId;
    return this.apiService.get<MlPromotion[]>(
      `/seller-promotions/users/${sellerId}?app_version=v2`,
      accessToken,
      'promotion',
    );
  }

  private groupPromotions(promotions: MlPromotion[]): MlPromotions {
    return {
      active: promotions.filter((promotion) => promotion.status === 'started'),

      candidates: promotions.filter(
        (promotion) => promotion.status === 'candidate',
      ),

      pending: promotions.filter((promotion) => promotion.status === 'pending'),

      all: promotions,
    };
  }

  /** Un fallo de promociones no debe romper toda la familia. */
  private async safeGet<T>(
    path: string,
    accessToken: string,
    fallback: T,
  ): Promise<T> {
    try {
      return await this.apiService.get<T>(path, accessToken);
    } catch {
      return fallback;
    }
  }
}
