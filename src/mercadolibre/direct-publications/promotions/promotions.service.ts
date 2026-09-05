import { Injectable } from '@nestjs/common';

import {
  MercadolibreApiService,
  type MercadolibreApiRequestOptions,
} from '../../shared/mercadolibre-api.service';

import {
  MlPromotion,
  type MlPromotionCampaignItem,
  type MlPromotionCampaignItemsResponse,
  type MlPromotions,
  type MlSellerPromotionsResponse,
} from './promotions.types';

@Injectable()
export class PromotionsService {
  constructor(
    private readonly apiService: MercadolibreApiService,
  ) {}

  async getPromotions(
    userId: string,
    itemId: string,
    accessToken: string,
  ): Promise<MlPromotions> {
    void userId;

    const promotions =
      await this.safeGet<MlPromotion[]>(
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

    const promotions =
      await this.apiService.get<MlPromotion[]>(
        `/seller-promotions/items/${itemId}?app_version=v2`,
        accessToken,
        'promotion',
        options,
      );

    return this.groupPromotions(promotions);
  }

  async getSellerCampaigns(
    userId: string,
    sellerId: number,
    accessToken: string,
  ): Promise<MlPromotion[]> {
    void userId;

    const response =
      await this.apiService.get<MlSellerPromotionsResponse>(
        `/seller-promotions/users/${sellerId}?app_version=v2`,
        accessToken,
        'promotion',
      );

    return response.results;
  }

  async getCampaignItems(
    userId: string,
    promotionId: string,
    promotionType: string,
    accessToken: string,
    paging?: Readonly<{
      limit?: number;
      offset?: number;
    }>,
  ): Promise<MlPromotionCampaignItemsResponse> {
    void userId;

    const query = new URLSearchParams({
      promotion_type: promotionType,
      app_version: 'v2',
    });

    if (paging?.limit !== undefined) {
      query.set(
        'limit',
        String(paging.limit),
      );
    }

    if (paging?.offset !== undefined) {
      query.set(
        'offset',
        String(paging.offset),
      );
    }

    return this.apiService.get<MlPromotionCampaignItemsResponse>(
      `/seller-promotions/promotions/${encodeURIComponent(
        promotionId,
      )}/items?${query.toString()}`,
      accessToken,
      'promotion',
    );
  }

  /*
   * Consulta dirigida:
   * una promoción concreta + un MLA concreto.
   *
   * Esta información tiene prioridad sobre
   * suggested_discounted_price y los datos
   * genéricos del endpoint por ítem.
   */
  async getCampaignItem(
    userId: string,
    promotionId: string,
    promotionType: string,
    itemId: string,
    accessToken: string,
  ): Promise<MlPromotionCampaignItem | null> {
    void userId;

    const query = new URLSearchParams({
      promotion_type: promotionType,
      item_id: itemId,
      app_version: 'v2',
    });

    try {
      const response =
        await this.apiService.get<MlPromotionCampaignItemsResponse>(
          `/seller-promotions/promotions/${encodeURIComponent(
            promotionId,
          )}/items?${query.toString()}`,
          accessToken,
          'promotion',
        );

      return (
        response.results.find(
          (item) => item.id === itemId,
        ) ??
        response.results[0] ??
        null
      );
    } catch {
      /*
       * No todos los tipos aceptan esta
       * consulta dirigida.
       * Si no está disponible conservamos
       * la respuesta original del ítem.
       */
      return null;
    }
  }

  private groupPromotions(
    promotions: MlPromotion[],
  ): MlPromotions {
    return {
      active: promotions.filter(
        (promotion) =>
          promotion.status === 'started',
      ),

      candidates: promotions.filter(
        (promotion) =>
          promotion.status === 'candidate',
      ),

      pending: promotions.filter(
        (promotion) =>
          promotion.status === 'pending',
      ),

      all: promotions,
    };
  }

  private async safeGet<T>(
    path: string,
    accessToken: string,
    fallback: T,
  ): Promise<T> {
    try {
      return await this.apiService.get<T>(
        path,
        accessToken,
      );
    } catch {
      return fallback;
    }
  }
}
