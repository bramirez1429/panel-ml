import { Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { MlItem, MlMultiGetResponse } from './items.types';

@Injectable()
export class ItemsService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  /** Trae un MLA directamente desde Mercado Libre. */
  getOne(itemId: string, accessToken: string): Promise<MlItem> {
    return this.apiService.get<MlItem>(`/items/${itemId}`, accessToken);
  }

  /** Trae varios MLA en lotes de máximo 20. */
  async getMany(itemIds: string[], accessToken: string): Promise<MlItem[]> {
    const result: MlItem[] = [];

    for (let i = 0; i < itemIds.length; i += 20) {
      const batch = itemIds.slice(i, i + 20);

      const items = await this.getBatch(batch, accessToken);

      result.push(...items);
    }

    return result;
  }

  /** Ejecuta un Multiget de hasta 20 MLA. */
  private async getBatch(
    itemIds: string[],
    accessToken: string,
  ): Promise<MlItem[]> {
    if (!itemIds.length) {
      return [];
    }

    const response = await this.apiService.get<MlMultiGetResponse[]>(
      `/items?ids=${itemIds.join(',')}`,
      accessToken,
    );

    return response.filter(({ code }) => code === 200).map(({ body }) => body);
  }
}
