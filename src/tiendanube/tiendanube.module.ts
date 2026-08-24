import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../database/supabase.service';
import { MercadolibreModule } from '../mercadolibre/mercadolibre.module';
import { TiendanubeOAuthService } from './auth/tiendanube-oauth.service';
import { SupabaseTiendanubeConnectionRepository } from './connections/supabase-tiendanube-connection.repository';
import { TiendanubeConnectionRepository } from './connections/tiendanube-connection.repository';
import { TiendanubeConnectionService } from './connections/tiendanube-connection.service';
import { TiendanubeProductsController } from './products/tiendanube-products.controller';
import { TiendanubeProductsService } from './products/tiendanube-products.service';
import { MercadoLibreReplicationSourceService } from './replication/mercadolibre-replication-source.service';
import { SupabaseTiendanubeProductLinkRepository } from './replication/supabase-tiendanube-product-link.repository';
import { TiendanubeProductLinkRepository } from './replication/tiendanube-product-link.repository';
import { TiendanubeReplicationController } from './replication/tiendanube-replication.controller';
import { TiendanubeReplicationService } from './replication/tiendanube-replication.service';
import { TiendanubeApiService } from './shared/tiendanube-api.service';
import { TiendanubeController } from './tiendanube.controller';
import { TiendanubePrivacyWebhookController } from './webhooks/tiendanube-privacy-webhook.controller';
import { TiendanubePrivacyWebhookService } from './webhooks/tiendanube-privacy-webhook.service';

@Module({
  imports: [ConfigModule, AuthModule, MercadolibreModule],
  controllers: [
    TiendanubeController,
    TiendanubeProductsController,
    TiendanubePrivacyWebhookController,
    TiendanubeReplicationController,
  ],
  providers: [
    SupabaseService,
    TiendanubeApiService,
    TiendanubeOAuthService,
    TiendanubeConnectionService,
    TiendanubeProductsService,
    TiendanubePrivacyWebhookService,
    TiendanubeReplicationService,
    MercadoLibreReplicationSourceService,
    {
      provide: TiendanubeConnectionRepository,
      useClass: SupabaseTiendanubeConnectionRepository,
    },
    {
      provide: TiendanubeProductLinkRepository,
      useClass: SupabaseTiendanubeProductLinkRepository,
    },
  ],
  exports: [TiendanubeApiService],
})
export class TiendanubeModule {}
