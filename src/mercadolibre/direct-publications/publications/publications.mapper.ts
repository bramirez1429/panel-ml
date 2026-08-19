import {
  PublicationModel,
  SharedProduct,
} from './publication.types';

import { MlItem } from '../items/items.types';

export class PublicationsMapper {
  static getModel(
    item: MlItem,
  ): PublicationModel {
    const hasFamily =
      Boolean(item.family_name) ||
      (
        item.family_id !== null &&
        item.family_id !== undefined
      );

    const hasVariations =
      Array.isArray(item.variations) &&
      item.variations.length > 0;

    /**
     * Si tiene family_id o family_name,
     * es definitivamente Versión nueva.
     */
    if (hasFamily) {
      return 'VARIANT_PRICING';
    }

    /**
     * Si todavía tiene variations[],
     * la tratamos como Versión clásica.
     *
     * Esto tiene prioridad sobre
     * user_product_listing.
     */
    if (hasVariations) {
      return 'SHARED';
    }

    /**
     * Si ya no tiene variations[]
     * pero Mercado Libre informa
     * user_product_listing,
     * es Versión nueva.
     */
    if (
      item.tags?.includes(
        'user_product_listing',
      )
    ) {
      return 'VARIANT_PRICING';
    }

    return 'SHARED';
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