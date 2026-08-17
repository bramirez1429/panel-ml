import { Injectable } from '@nestjs/common';

import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { MlPromotion } from './promotions.types';

@Injectable()
export class PromotionsService {
  constructor(
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Obtiene todas las promociones de un MLA. */
  async getPromotions(
    itemId: string,
    accessToken: string,
  ) {
    const promotions = await this.safeGet<MlPromotion[]>(
      `/seller-promotions/items/${itemId}?app_version=v2`,
      accessToken,
      [],
    );

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

  /** Un fallo de promociones no debe romper toda la familia. */
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