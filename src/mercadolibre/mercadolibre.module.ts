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

import { FamiliesController } from './direct-publications/families/families.controller';
import { FamiliesService } from './direct-publications/families/families.service';
import { FamiliesDetailService } from './direct-publications/families/families-detail.service';
import { ItemsService } from './direct-publications/items/items.service';
import { PublicationsSearchService } from './direct-publications/publications/publications-search.service';
import { PricingService } from './direct-publications/pricing/pricing.service';
import { PromotionsService } from './direct-publications/promotions/promotions.service';
import { PublicationDetailService } from './direct-publications/publications/publication-detail.service';
import { ItemEditService } from './direct-publications/editing/item-edit.service';
import { ItemEditController } from './direct-publications/editing/item-edit.controller';
import { FamilyEditService } from './direct-publications/editing/family-edit.service';
import { StockEditService } from './direct-publications/editing/stock-edit.service';
import { SkuEditService } from './direct-publications/editing/sku-edit.service';
import { PicturesEditService } from './direct-publications/editing/pictures-edit.service';
import { DescriptionEditService } from './direct-publications/editing/description-edit.service';
import { DescriptionEditController } from './direct-publications/editing/description-edit.controller';
import { AttributeEditService } from './direct-publications/editing/attribute-edit.service';
import { AttributeEditController } from './direct-publications/editing/attribute-edit.controller';

@Module({
  controllers: [
    MercadolibreController,
    PublicationsController,
    WebhookController,
    FamiliesController,
    ItemEditController,
    DescriptionEditController,
    AttributeEditController
    
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
    ItemEditService,
  FamilyEditService,
  StockEditService,
  SkuEditService,
  PicturesEditService,
  DescriptionEditService,
  AttributeEditService
  ],
})
export class MercadolibreModule {}
