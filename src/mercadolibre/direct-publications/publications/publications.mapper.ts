import { PublicationModel, SharedProduct } from './publication.types';

import { MlItem } from '../items/items.types';


export class PublicationsMapper {
  static getModel(
    item: MlItem,
  ): PublicationModel {
    const isVariantPricing =
      Boolean(item.family_name) ||
      Boolean(item.family_id) ||
      item.tags?.includes(
        'user_product_listing',
      );

    return isVariantPricing
      ? 'VARIANT_PRICING'
      : 'SHARED';
  }

  static toDirectPublication(
    item: MlItem,
  ) {
    return {
      ...item,
      model: this.getModel(item),
    };
  }

  static toSharedProduct(
    item: MlItem,
  ): SharedProduct {
    return {
      key: `item:${item.id}`,

      model: 'SHARED',

      itemId: item.id,

      title:
        item.title ?? null,

      price:
        item.price ?? null,

      stock:
        item.available_quantity ?? 0,

      sold:
        item.sold_quantity ?? 0,

      status:
        item.status ?? null,

      thumbnail:
        item.thumbnail ?? null,

      variations:
        item.variations ?? [],
    };
  }

  static getFamilyIds(
    items: MlItem[],
  ): string[] {
    return [
      ...new Set(
        items
          .filter(
            (item) =>
              this.getModel(item) ===
                'VARIANT_PRICING' &&
              item.family_id,
          )
          .map((item) =>
            String(item.family_id),
          ),
      ),
    ];
  }
}