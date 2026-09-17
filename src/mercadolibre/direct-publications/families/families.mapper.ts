import { MlItem } from '../items/items.types';
import { MlFamilyResponse } from './families-ml.types';
import {
  FamilyListingSummary,
  FamilySummary,
  FamilyVariantSummary,
} from './family.types';

export class FamiliesMapper {
  static toListingSummary(
    family: MlFamilyResponse,
    items: MlItem[],
  ): FamilyListingSummary {
    const firstItem = items[0];
    const prices = items.flatMap((item) =>
      item.price === undefined ? [] : [item.price],
    );

    return {
      key: `family:${family.family_id}`,
      model: 'VARIANT_PRICING',
      familyId: String(family.family_id),
      familyName: items.find((item) => item.family_name)?.family_name ?? null,
      variantsCount: family.user_products_ids.length,
      itemsCount: items.length,
      itemId: firstItem?.id ?? null,
      userProductId: firstItem?.user_product_id ?? null,
      title: firstItem?.title ?? null,
      priceFrom: prices.length > 0 ? Math.min(...prices) : null,
      priceTo: prices.length > 0 ? Math.max(...prices) : null,
      currency: items.find((item) => item.currency_id)?.currency_id ?? null,
      stock: items.reduce(
        (total, item) => total + (item.available_quantity ?? 0),
        0,
      ),
      sold: items.reduce(
        (total, item) => total + (item.sold_quantity ?? 0),
        0,
      ),
      status: firstItem?.status ?? null,
      thumbnail: firstItem?.thumbnail ?? null,
      permalink: firstItem?.permalink ?? null,
    };
  }

  static toSummary(family: MlFamilyResponse, items: MlItem[]): FamilySummary {
    const variants = new Map<string, FamilyVariantSummary>();

    for (const item of items) {
      const userProductId = item.user_product_id;

      if (!userProductId) {
        continue;
      }

      const variant = variants.get(userProductId) ?? {
        userProductId,
        items: [],
      };

      variant.items.push({
        itemId: item.id,
        title: item.title ?? null,

        price: item.price ?? null,

        stock: item.available_quantity ?? 0,

        sold: item.sold_quantity ?? 0,

        status: item.status ?? null,

        inventoryId: item.inventory_id ?? null,

        thumbnail: item.thumbnail ?? null,

        pictures: item.pictures ?? [],

        attributes: item.attributes ?? [],
      });

      variants.set(userProductId, variant);
    }

    return {
      key: `family:${family.family_id}`,

      model: 'VARIANT_PRICING',

      familyId: String(family.family_id),

      familyName: items.find((item) => item.family_name)?.family_name ?? null,

      variantsCount: family.user_products_ids.length,

      itemsCount: items.length,

      variants: [...variants.values()],
    };
  }
}
