import { Injectable } from '@nestjs/common';

import { FamiliesService } from './families.service';
import { PricingService } from '../pricing/pricing.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PublicationDetailMapper } from '../publications/publication-detail.mapper';

@Injectable()
export class FamiliesDetailService {
  constructor(
    private readonly familiesService: FamiliesService,
    private readonly pricingService: PricingService,
    private readonly promotionsService: PromotionsService,
  ) {}

  /** Devuelve una familia completa con precio y promociones. */
  async getDetail(familyId: string) {
    const { family, items, accessToken } =
      await this.familiesService.getFamilyItems(familyId);

    const variants = [];

    // Concurrencia baja para no sobrecargar Mercado Libre.
    for (let i = 0; i < items.length; i += 2) {
      const batch = items.slice(i, i + 2);

      const enriched = await Promise.all(
        batch.map(async (item) => {
          const [price, promotions] = await Promise.all([
            this.pricingService.getPrice(item, accessToken),

            this.promotionsService.getPromotions(item.id, accessToken),
          ]);

          const friendlyStatus = PublicationDetailMapper.getStatus(item.status);

          const friendlyPricing = PublicationDetailMapper.getPricing(price);

          const friendlyPromotion =
            PublicationDetailMapper.getPromotion(promotions);

          const friendlyShipping = PublicationDetailMapper.getShipping(
            item.shipping,
          );

          return {
            itemId: item.id,

            userProductId: item.user_product_id ?? null,

            title: item.title ?? null,

            friendly: {
              status: friendlyStatus,
              pricing: friendlyPricing,
              promotion: friendlyPromotion,
              shipping: friendlyShipping,
            },

            status: item.status ?? null,

            subStatus: item.sub_status ?? [],

            stock: {
              available: item.available_quantity ?? 0,

              initial: item.initial_quantity ?? 0,

              sold: item.sold_quantity ?? 0,
            },

            sku: {
              sellerCustomField: item.seller_custom_field ?? null,

              inventoryId: item.inventory_id ?? null,
            },

            price,

            promotions,

            thumbnail: item.thumbnail ?? null,

            pictures: item.pictures ?? [],

            attributes: item.attributes ?? [],

            shipping: item.shipping ?? null,

            listingTypeId: item.listing_type_id ?? null,

            permalink: item.permalink ?? null,

            updatedAt: item.last_updated ?? null,
          };
        }),
      );

      variants.push(...enriched);
    }

    return {
      model: 'VARIANT_PRICING',
      version: 'NEW',
      versionLabel: 'Versión nueva',

      familyId: String(family.family_id),

      familyName: items.find((item) => item.family_name)?.family_name ?? null,

      userProductsCount: family.user_products_ids.length,

      itemsCount: items.length,

      userProductIds: family.user_products_ids,

      variants,
    };
  }
}
