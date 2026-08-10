import { Module } from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../database/repositories/mercadolibre-products.repository';
import { SupabaseService } from '../database/supabase.service';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreTokenService } from './auth/mercadolibre-token.service';
import { MercadolibreController } from './mercadolibre.controller';
import { PublicationModelDetectorService } from './publications/normalization/publication-model-detector.service';
import { PublicationNormalizerService } from './publications/normalization/publication-normalizer.service';
import { PublicationsController } from './publications/publications.controller';
import { PublicationsService } from './publications/publications.service';
import { PublicationSourceService } from './publications/sync/publication-source.service';
import { PublicationSyncPreparerService } from './publications/sync/publication-sync-preparer.service';
import { PublicationSyncWriterService } from './publications/sync/publication-sync-writer.service';
import { PublicationSyncService } from './publications/sync/publication-sync.service';
import { MercadolibreApiService } from './shared/mercadolibre-api.service';
import { UserProductFamilyService } from './user-products/user-product-family.service';
import { UserProductsService } from './user-products/user-products.service';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookService } from './webhook/webhook.service';

@Module({
  controllers: [
    MercadolibreController,
    PublicationsController,
    WebhookController,
  ],
  providers: [
    SupabaseService,
    MercadolibreProductsRepository,
    MercadolibreChildrenRepository,
    MercadolibreApiService,
    MercadolibreAuthService,
    MercadolibreTokenService,
    UserProductsService,
    UserProductFamilyService,
    PublicationModelDetectorService,
    PublicationNormalizerService,
    PublicationSourceService,
    PublicationSyncPreparerService,
    PublicationSyncWriterService,
    PublicationSyncService,
    PublicationsService,
    WebhookService,
  ],
})
export class MercadolibreModule {}
