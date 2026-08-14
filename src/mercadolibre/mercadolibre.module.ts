import { Module } from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../database/repositories/mercadolibre-products.repository';
import { MercadolibreSyncJobsRepository } from '../database/repositories/mercadolibre-sync-jobs.repository';
import { MercadolibrePublicationActionsRepository } from '../database/repositories/mercadolibre-publication-actions.repository';
import { SupabaseService } from '../database/supabase.service';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreTokenService } from './auth/mercadolibre-token.service';
import { MercadolibreController } from './mercadolibre.controller';
import { PublicationModelDetectorService } from './publications/normalization/publication-model-detector.service';
import { PublicationNormalizerService } from './publications/normalization/publication-normalizer.service';
import { PublicationsController } from './publications/publications.controller';
import { PublicationCommercialController } from './publications/publication-commercial.controller';
import { PublicationMutationsController } from './publications/publication-mutations.controller';
import { PublicationPublishingController } from './publications/publication-publishing.controller';
import { PublicationsService } from './publications/publications.service';
import { PublicationPriceService } from './publications/mutations/publication-price.service';
import { PublicationStockService } from './publications/mutations/publication-stock.service';
import { PublicationManagementReaderService } from './publications/mutations/publication-management-reader.service';
import { PublicationManagementTargetService } from './publications/mutations/publication-management-target.service';
import { PublicationPicturesService } from './publications/mutations/publication-pictures.service';
import { PublicationPictureUploadService } from './publications/mutations/publication-picture-upload.service';
import { PublicationSkuService } from './publications/mutations/publication-sku.service';
import { PublicationSnapshotService } from './publications/mutations/publication-snapshot.service';
import { PublicationStatusService } from './publications/mutations/publication-status.service';
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
import { PublicationActivityService } from './publications/activity/publication-activity.service';
import { PublicationAttributesService } from './publications/mutations/publication-attributes.service';
import { PublicationCapabilitiesService } from './publications/mutations/publication-capabilities.service';
import { PublicationDescriptionService } from './publications/mutations/publication-description.service';
import { PublicationLiveContentService } from './publications/mutations/publication-live-content.service';
import { PublicationTitleService } from './publications/mutations/publication-title.service';
import { PublicationPricesService } from './publications/prices/publication-prices.service';
import { PublicationOfficialPriceService } from './publications/prices/publication-official-price.service';
import { PublicationPromotionsService } from './publications/promotions/publication-promotions.service';
import { PublicationCategoriesService } from './publications/publishing/publication-categories.service';
import { PublicationPublishingCapabilitiesService } from './publications/publishing/publication-publishing-capabilities.service';
import { PublicationPublishingPlannerService } from './publications/publishing/publication-publishing-planner.service';
import { PublicationPublishingService } from './publications/publishing/publication-publishing.service';
import { PublicationValidationService } from './publications/publishing/publication-validation.service';

@Module({
  controllers: [
    MercadolibreController,
    PublicationsController,
    PublicationPublishingController,
    PublicationCommercialController,
    PublicationMutationsController,
    WebhookController,
  ],
  providers: [
    SupabaseService,
    MercadolibreProductsRepository,
    MercadolibreChildrenRepository,
    MercadolibreSyncJobsRepository,
    MercadolibrePublicationActionsRepository,
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
    PublicationPriceService,
    PublicationStockService,
    PublicationManagementTargetService,
    PublicationSnapshotService,
    PublicationManagementReaderService,
    PublicationStatusService,
    PublicationSkuService,
    PublicationPicturesService,
    PublicationPictureUploadService,
    PublicationActivityService,
    PublicationLiveContentService,
    PublicationTitleService,
    PublicationDescriptionService,
    PublicationAttributesService,
    PublicationCapabilitiesService,
    PublicationPricesService,
    PublicationOfficialPriceService,
    PublicationPromotionsService,
    PublicationPublishingCapabilitiesService,
    PublicationCategoriesService,
    PublicationPublishingPlannerService,
    PublicationValidationService,
    PublicationPublishingService,
    WebhookService,
  ],
})
export class MercadolibreModule {}
