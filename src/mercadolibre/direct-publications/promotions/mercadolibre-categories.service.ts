import { BadGatewayException, Injectable } from '@nestjs/common';

import { PUBLICATION_REQUEST_CONCURRENCY } from '../../publications/publication.constants';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';

import type { PromotionCatalogCategory } from './promotions-catalog.types';

@Injectable()
export class MercadoLibreCategoriesService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  async getMany(
    categoryIds: readonly string[],
    accessToken: string,
  ): Promise<Map<string, PromotionCatalogCategory>> {
    const ids = [...new Set(categoryIds)];
    const categories = new Map<string, PromotionCatalogCategory>();

    for (
      let index = 0;
      index < ids.length;
      index += PUBLICATION_REQUEST_CONCURRENCY
    ) {
      const batch = ids.slice(index, index + PUBLICATION_REQUEST_CONCURRENCY);
      const resolved = await Promise.all(
        batch.map((id) => this.getOne(id, accessToken)),
      );
      resolved.forEach((category) => categories.set(category.id, category));
    }
    return categories;
  }

  private async getOne(
    categoryId: string,
    accessToken: string,
  ): Promise<PromotionCatalogCategory> {
    const data = await this.apiService.get<unknown>(
      `/categories/${encodeURIComponent(categoryId)}`,
      accessToken,
    );
    if (
      !isJsonObject(data) ||
      data.id !== categoryId ||
      !isNonEmptyString(data.name) ||
      !Array.isArray(data.path_from_root)
    ) {
      throw new BadGatewayException('Respuesta de categoría inválida');
    }
    const path = data.path_from_root.flatMap((entry: unknown) =>
      isJsonObject(entry) && isNonEmptyString(entry.name)
        ? [entry.name.trim()]
        : [],
    );
    if (path.length === 0) {
      throw new BadGatewayException('Respuesta de categoría inválida');
    }
    return { id: categoryId, name: data.name.trim(), path };
  }
}
