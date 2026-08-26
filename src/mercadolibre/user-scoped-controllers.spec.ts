import 'reflect-metadata';
import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { AttributesController } from './direct-publications/attributes/attributes.controller';
import { DescriptionController } from './direct-publications/description/description.controller';
import { FamiliesController } from './direct-publications/families/families.controller';
import { FamilyController } from './direct-publications/families/family.controller';
import { ItemController } from './direct-publications/items/item.controller';
import { PicturesController } from './direct-publications/pictures/pictures.controller';
import { DealController } from './direct-publications/promotions/deal.controller';
import { PriceDiscountController } from './direct-publications/promotions/price-discount.controller';
import { PromotionManagerController } from './direct-publications/promotions/promotion-manager.controller';
import { PromotionsCatalogController } from './direct-publications/promotions/promotions-catalog.controller';
import { SellerCampaignController } from './direct-publications/promotions/seller-campaign.controller';
import { SmartPromotionController } from './direct-publications/promotions/smart-promotion.controller';
import { PublicationsController } from './direct-publications/publications/publications.controller';
import { ShippingController } from './direct-publications/shipping/shipping.controller';
import { SkuController } from './direct-publications/sku/sku.controller';
import { StockController } from './direct-publications/stock/stock.controller';
import { MercadolibreController } from './mercadolibre.controller';
import { MercadolibreModule } from './mercadolibre.module';
import { WebhookController } from './webhook/webhook.controller';

const USER_SCOPED_CONTROLLERS = [
  PublicationsController,
  FamiliesController,
  FamilyController,
  StockController,
  SkuController,
  PicturesController,
  ItemController,
  DescriptionController,
  AttributesController,
  ShippingController,
  PriceDiscountController,
  DealController,
  SellerCampaignController,
  SmartPromotionController,
  PromotionManagerController,
  PromotionsCatalogController,
] as const;

function guardsFor(controller: object): unknown[] {
  const metadata = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown;
  return Array.isArray(metadata) ? (metadata as unknown[]) : [];
}

describe('guards de controllers de Mercado Libre', () => {
  it.each(USER_SCOPED_CONTROLLERS)(
    '%p exige AccessTokenGuard',
    (controller) => {
      expect(guardsFor(controller)).toContain(AccessTokenGuard);
    },
  );

  it('incluye todos los controllers directos registrados en el módulo', () => {
    const metadata = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      MercadolibreModule,
    ) as unknown;
    const registered = Array.isArray(metadata) ? (metadata as unknown[]) : [];
    const directControllers = registered.filter(
      (controller) =>
        controller !== MercadolibreController &&
        controller !== WebhookController,
    );

    expect(directControllers).toEqual([...USER_SCOPED_CONTROLLERS]);
  });

  it('mantiene público el webhook de Mercado Libre', () => {
    expect(guardsFor(WebhookController)).not.toContain(AccessTokenGuard);
  });
});
