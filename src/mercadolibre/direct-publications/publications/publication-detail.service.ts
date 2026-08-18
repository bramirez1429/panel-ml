import { Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { ItemsService } from '../items/items.service';
import { PricingService } from '../pricing/pricing.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PublicationsMapper } from './publications.mapper';

@Injectable()
export class PublicationDetailService {
    constructor(
        private readonly tokenService: MercadolibreTokenService,
        private readonly itemsService: ItemsService,
        private readonly pricingService: PricingService,
        private readonly promotionsService: PromotionsService,
    ) { }

    async getDetail(itemId: string) {
  const accessToken =
    await this.tokenService.getValidAccessToken();

  const item = await this.itemsService.getOne(
    itemId,
    accessToken,
  );

  const [price, promotions] = await Promise.all([
    this.pricingService.getPrice(
      item,
      accessToken,
    ),
    this.promotionsService.getPromotions(
      itemId,
      accessToken,
    ),
  ]);

  return {
    model: PublicationsMapper.getModel(item),

    itemId: item.id,
    title: item.title ?? null,

    familyId: item.family_id
      ? String(item.family_id)
      : null,

    familyName: item.family_name ?? null,
    userProductId: item.user_product_id ?? null,

    status: item.status ?? null,
    subStatus: item.sub_status ?? [],
    condition: item.condition ?? null,

    stock: {
      available: item.available_quantity ?? 0,
      initial: item.initial_quantity ?? 0,
      sold: item.sold_quantity ?? 0,
    },

    price,
    promotions,

    sku: item.seller_custom_field ?? null,
    inventoryId: item.inventory_id ?? null,

    thumbnail: item.thumbnail ?? null,
    pictures: item.pictures ?? [],

    variations: item.variations ?? [],
    attributes: item.attributes ?? [],

    shipping: item.shipping ?? null,
    listingTypeId: item.listing_type_id ?? null,

    tags: item.tags ?? [],
    channels: item.channels ?? [],

    permalink: item.permalink ?? null,

    saleTerms: item.sale_terms ?? [],
    warranty: item.warranty ?? null,

    catalogProductId: item.catalog_product_id ?? null,
    health: item.health ?? null,

    dateCreated: item.date_created ?? null,
    lastUpdated: item.last_updated ?? null,
  };
}
}