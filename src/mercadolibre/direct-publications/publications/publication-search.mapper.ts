import type { MlItem } from '../items/items.types';
import type { PublicationSearchItem } from './publication-search.types';
import { PublicationsMapper } from './publications.mapper';

export class PublicationSearchMapper {
  static toResult(
    item: MlItem,
    familyIdOverride?: string,
  ): PublicationSearchItem {
    return {
      itemId: item.id,
      familyId:
        familyIdOverride ??
        (item.family_id === null || item.family_id === undefined
          ? null
          : String(item.family_id)),
      title: item.title ?? null,
      thumbnail: item.thumbnail ?? null,
      price: item.price ?? null,
      currencyId: item.currency_id ?? null,
      status: item.status ?? null,
      stock: item.available_quantity ?? null,
      sold: item.sold_quantity ?? null,
      permalink: item.permalink ?? null,
      model: PublicationsMapper.getModel(item),
    };
  }
}
