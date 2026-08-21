import { Injectable } from '@nestjs/common';

import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { MlItem } from '../items/items.types';

import { MlPricesResponse, MlSalePriceResponse } from './pricing.types';

@Injectable()
export class PricingService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  /** Obtiene todos los datos de precio de un MLA. */
  async getPrice(item: MlItem, accessToken: string) {
    const [prices, salePrice] = await Promise.all([
      this.getPrices(item.id, accessToken),
      this.getSalePrice(item.id, accessToken),
    ]);

    const standard = prices?.prices?.find((price) => price.type === 'standard');

    const promotion = prices?.prices?.find(
      (price) => price.type === 'promotion',
    );

    return {
      standard: standard?.amount ?? item.price ?? null,

      current: salePrice?.amount ?? promotion?.amount ?? item.price ?? null,

      regular: salePrice?.regular_amount ?? promotion?.regular_amount ?? null,

      currency:
        salePrice?.currency_id ??
        standard?.currency_id ??
        item.currency_id ??
        null,

      all: prices?.prices ?? [],

      metadata: salePrice?.metadata ?? {},
    };
  }

  /** Consulta precios registrados del MLA. */
  private async getPrices(itemId: string, accessToken: string) {
    return this.safeGet<MlPricesResponse | null>(
      `/items/${itemId}/prices`,
      accessToken,
      null,
    );
  }

  /** Consulta el precio actual visible en marketplace. */
  private async getSalePrice(itemId: string, accessToken: string) {
    return this.safeGet<MlSalePriceResponse | null>(
      `/items/${itemId}/sale_price?context=channel_marketplace`,
      accessToken,
      null,
    );
  }

  /** Un fallo de precio no debe romper toda la familia. */
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
