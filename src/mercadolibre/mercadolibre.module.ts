import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MercadolibreSaleIngestionService } from '../sales/mercadolibre-sale-ingestion.service';
import { SalesPersistenceModule } from '../sales/sales-persistence.module';
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
import { PublicationsGlobalSearchService } from './direct-publications/publications/publications-global-search.service';
import { PublicationCatalogScannerService } from './direct-publications/publications/publication-catalog-scanner.service';
import { PublicationSearchService } from './direct-publications/publications/publication-search.service';
import { PublicationTitleItemsSearchService } from './direct-publications/publications/publication-title-items-search.service';
import { PricingService } from './direct-publications/pricing/pricing.service';
import { PromotionsService } from './direct-publications/promotions/promotions.service';
import { PublicationDetailService } from './direct-publications/publications/publication-detail.service';
import { ItemUpdateService } from './direct-publications/items/item-update.service';
import { VariationDeletionService } from './direct-publications/items/variation-deletion.service';
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
import { PromotionsCatalogController } from './direct-publications/promotions/promotions-catalog.controller';
import { PromotionsCatalogService } from './direct-publications/promotions/promotions-catalog.service';
import { PromotionsCampaignsService } from './direct-publications/promotions/promotions-campaigns.service';
import { MercadoLibreSellingFeeService } from './direct-publications/promotions/mercadolibre-selling-fee.service';
import { PromotionOptionsService } from './direct-publications/promotions/promotion-options.service';
import { PromotionApplicationService } from './direct-publications/promotions/promotion-application.service';
import { PromotionRemovalService } from './direct-publications/promotions/promotion-removal.service';
import { PromotionSelectionService } from './direct-publications/promotions/promotion-selection.service';
import { PublicationPromotionExecutorService } from './direct-publications/promotions/publication-promotion-executor.service';
import { PublicationPromotionPreflightService } from './direct-publications/promotions/publication-promotion-preflight.service';
import { PublicationPromotionSourceService } from './direct-publications/promotions/publication-promotion-source.service';
import { PublicationPromotionService } from './direct-publications/promotions/publication-promotion.service';
import { PromotionBulkJobRepository } from './direct-publications/promotions/promotion-bulk-job.repository';
import { PromotionBulkJobService } from './direct-publications/promotions/promotion-bulk-job.service';
import { PromotionBulkJobQueue } from './direct-publications/promotions/promotion-bulk-job.queue';
import { StockService } from './direct-publications/stock/stock.service';
import { StockBulkController } from './direct-publications/stock-bulk/stock-bulk.controller';
import { StockBulkDispatcher } from './direct-publications/stock-bulk/stock-bulk-dispatcher';
import { StockBulkErrorPolicy } from './direct-publications/stock-bulk/stock-bulk-error-policy';
import { StockBulkJobQueue } from './direct-publications/stock-bulk/stock-bulk-job.queue';
import { StockBulkJobRepository } from './direct-publications/stock-bulk/stock-bulk-job.repository';
import { StockBulkJobService } from './direct-publications/stock-bulk/stock-bulk-job.service';
import { StockBulkLocalDispatcher } from './direct-publications/stock-bulk/stock-bulk-local.dispatcher';
import { StockBulkPreviewService } from './direct-publications/stock-bulk/stock-bulk-preview.service';
import { StockBulkTargetsService } from './direct-publications/stock-bulk/stock-bulk-targets.service';
import { SkuService } from './direct-publications/sku/sku.service';
import { PicturesService } from './direct-publications/pictures/pictures.service';
import { DescriptionService } from './direct-publications/description/description.service';
import { DescriptionController } from './direct-publications/description/description.controller';
import { AttributesService } from './direct-publications/attributes/attributes.service';
import { AttributesController } from './direct-publications/attributes/attributes.controller';
import { ShippingService } from './direct-publications/shipping/shipping.service';
import { ShippingController } from './direct-publications/shipping/shipping.controller';
import { SimilarPublicationController } from './direct-publications/similar-publications/similar-publication.controller';
import { SimilarPublicationDraftMapper } from './direct-publications/similar-publications/similar-publication.mapper';
import { SimilarPublicationSourceService } from './direct-publications/similar-publications/similar-publication-source.service';
import { SimilarPublicationValidationService } from './direct-publications/similar-publications/similar-publication-validation.service';
import { SimilarPublicationCreationService } from './direct-publications/similar-publications/similar-publication-creation.service';
import { MercadoLibrePictureUploadService } from './direct-publications/similar-publications/mercadolibre-picture-upload.service';
import { SimilarPublicationMetadataService } from './direct-publications/similar-publications/similar-publication-metadata.service';
import { SimilarPublicationBase64UploadService } from './direct-publications/similar-publications/similar-publication-base64-upload.service';
import { ProductRankingController } from './direct-publications/product-ranking/product-ranking.controller';
import { ProductRankingService } from './direct-publications/product-ranking/product-ranking.service';
import { ProductRankingVisitsService } from './direct-publications/product-ranking/product-ranking-visits.service';
import { MercadolibreIntegrationStatusService } from './integration-status/mercadolibre-integration-status.service';

@Module({
  imports: [AuthModule, SalesPersistenceModule],
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
    PromotionManagerController,
    PromotionsCatalogController,
    SimilarPublicationController,
    ProductRankingController,
    StockBulkController,
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
    MercadolibreSaleIngestionService,
    FamiliesService,
    FamiliesDetailService,
    ItemsService,
    PublicationsSearchService,
    PublicationCatalogScannerService,
    PublicationsGlobalSearchService,
    PublicationTitleItemsSearchService,
    PublicationSearchService,
    PricingService,
    PromotionsService,
    PublicationDetailService,
    ItemUpdateService,
    VariationDeletionService,
    FamilyUpdateService,
    StockService,
    StockBulkTargetsService,
    StockBulkPreviewService,
    StockBulkJobRepository,
    StockBulkErrorPolicy,
    StockBulkJobService,
    StockBulkJobQueue,
    StockBulkLocalDispatcher,
    StockBulkDispatcher,
    SkuService,
    PicturesService,
    DescriptionService,
    AttributesService,
    ShippingService,
    PriceDiscountService,
    DealService,
    SellerCampaignService,
    SmartPromotionService,
    PromotionManagerService,
    PromotionsCatalogService,
    PromotionsCampaignsService,
    MercadoLibreSellingFeeService,
    PromotionOptionsService,
    PromotionApplicationService,
    PromotionRemovalService,
    PromotionSelectionService,
    PublicationPromotionSourceService,
    PublicationPromotionPreflightService,
    PublicationPromotionExecutorService,
    PublicationPromotionService,
    PromotionBulkJobRepository,
    PromotionBulkJobService,
    PromotionBulkJobQueue,
    SimilarPublicationDraftMapper,
    SimilarPublicationSourceService,
    SimilarPublicationValidationService,
    SimilarPublicationCreationService,
    MercadoLibrePictureUploadService,
    SimilarPublicationMetadataService,
    SimilarPublicationBase64UploadService,
    ProductRankingService,
    ProductRankingVisitsService,
    MercadolibreIntegrationStatusService,
  ],
  exports: [
    MercadolibreProductsRepository,
    MercadolibreChildrenRepository,
    MercadolibreTokenService,
    PublicationSourceService,
    UserProductFamilyService,
    DescriptionService,
    MercadolibreApiService,
    MercadolibreSaleIngestionService,
    FamiliesService,
  ],
})
export class MercadolibreModule {}
