import { Module } from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../database/repositories/mercadolibre-products.repository';
import { MercadolibreSyncJobsRepository } from '../database/repositories/mercadolibre-sync-jobs.repository';
import { SupabaseService } from '../database/supabase.service';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreTokenService } from './auth/mercadolibre-token.service';
import { MercadolibreController } from './mercadolibre.controller';
import { PublicationModelDetectorService } from './publications/normalization/publication-model-detector.service';
import { PublicationNormalizerService } from './publications/normalization/publication-normalizer.service';
import { PublicationsController } from './direct-publications/publications/publications.controller';
// import { PublicationsService } from './publications/publications.service'; es de la parte vieja con supabase
import { PublicationsService } from './direct-publications/publications/publications.service';
import { PublicationSourceService } from './publications/sync/publication-source.service';
import { PublicationFamilySyncService } from './publications/sync/publication-family-sync.service';
import { PublicationSyncPreparerService } from './publications/sync/publication-sync-preparer.service';
import { PublicationSyncJobService } from './publications/sync/publication-sync-job.service';
import { PublicationSyncQueueService } from './publications/sync/publication-sync-queue.service';
import { PublicationSyncWriterService } from './publications/sync/publication-sync-writer.service';
import { PublicationSyncService } from './publications/sync/publication-sync.service';
import { MercadolibreApiService } from './shared/mercadolibre-api.service';
import { UserProductFamilyService } from './user-products/user-product-family.service';
import { UserProductsService } from './user-products/user-products.service';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookService } from './webhook/webhook.service';

import { FamilyController } from './direct-publications/families/family.controller';
import { StockController } from './direct-publications/stock/stock.controller';
import { SkuController } from './direct-publications/sku/sku.controller';
import { PicturesController } from './direct-publications/pictures/pictures.controller';
import { FamiliesController } from './direct-publications/families/families.controller';
import { FamiliesService } from './direct-publications/families/families.service';
import { FamiliesDetailService } from './direct-publications/families/families-detail.service';
import { ItemsService } from './direct-publications/items/items.service';
import { PublicationsSearchService } from './direct-publications/publications/publications-search.service';
import { PricingService } from './direct-publications/pricing/pricing.service';
import { PromotionsService } from './direct-publications/promotions/promotions.service';
import { PublicationDetailService } from './direct-publications/publications/publication-detail.service';
import { ItemUpdateService } from './direct-publications/items/item-update.service';
import { ItemController } from './direct-publications/items/item.controller';
import { FamilyUpdateService } from './direct-publications/families/family-update.service';
import { PriceDiscountService } from './direct-publications/promotions/price-discount.service';
import { PriceDiscountController } from './direct-publications/promotions/price-discount.controller';
import { DealService } from './direct-publications/promotions/deal.service';
import { DealController } from './direct-publications/promotions/deal.controller';
import { SellerCampaignService } from './direct-publications/promotions/seller-campaign.service';
import { SmartPromotionService } from './direct-publications/promotions/smart-promotion.service';
import { PromotionManagerService } from './direct-publications/promotions/promotion-manager.service';
import { SellerCampaignController } from './direct-publications/promotions/seller-campaign.controller';
import { SmartPromotionController } from './direct-publications/promotions/smart-promotion.controller';
import { PromotionManagerController } from './direct-publications/promotions/promotion-manager.controller';
import { StockService } from './direct-publications/stock/stock.service';
import { SkuService } from './direct-publications/sku/sku.service';
import { PicturesService } from './direct-publications/pictures/pictures.service';
import { DescriptionService } from './direct-publications/description/description.service';
import { DescriptionController } from './direct-publications/description/description.controller';
import { AttributesService } from './direct-publications/attributes/attributes.service';
import { AttributesController } from './direct-publications/attributes/attributes.controller';
import { ShippingService } from './direct-publications/shipping/shipping.service';
import { ShippingController } from './direct-publications/shipping/shipping.controller';


@Module({
  controllers: [
    MercadolibreController,
    PublicationsController,
    WebhookController,
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
  ],
  providers: [
    SupabaseService,
    MercadolibreProductsRepository,
    MercadolibreChildrenRepository,
    MercadolibreSyncJobsRepository,
    MercadolibreApiService,
    MercadolibreAuthService,
    MercadolibreTokenService,
    UserProductsService,
    UserProductFamilyService,
    PublicationModelDetectorService,
    PublicationNormalizerService,
    PublicationSourceService,
    PublicationFamilySyncService,
    PublicationSyncPreparerService,
    PublicationSyncWriterService,
    PublicationSyncService,
    PublicationSyncJobService,
    PublicationSyncQueueService,
    PublicationsService,
    WebhookService,
    FamiliesService,
    FamiliesDetailService,
    ItemsService,
    PublicationsSearchService,
    PricingService,
    PromotionsService,
    PublicationDetailService,
    ItemUpdateService,
    FamilyUpdateService,
    StockService,
    SkuService,
    PicturesService,
    DescriptionService,
    AttributesService,
    ShippingService,
    PriceDiscountService,
    DealService,
    SellerCampaignService,
    SmartPromotionService,
  ],
})
export class MercadolibreModule { }
