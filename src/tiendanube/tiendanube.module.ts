import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../database/supabase.service';
import { TiendanubeOAuthService } from './auth/tiendanube-oauth.service';
import { SupabaseTiendanubeConnectionRepository } from './connections/supabase-tiendanube-connection.repository';
import { TiendanubeConnectionRepository } from './connections/tiendanube-connection.repository';
import { TiendanubeConnectionService } from './connections/tiendanube-connection.service';
import { TiendanubeApiService } from './shared/tiendanube-api.service';
import { TiendanubeController } from './tiendanube.controller';
import { TiendanubePrivacyWebhookController } from './webhooks/tiendanube-privacy-webhook.controller';
import { TiendanubePrivacyWebhookService } from './webhooks/tiendanube-privacy-webhook.service';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [TiendanubeController, TiendanubePrivacyWebhookController],
  providers: [
    SupabaseService,
    TiendanubeApiService,
    TiendanubeOAuthService,
    TiendanubeConnectionService,
    TiendanubePrivacyWebhookService,
    {
      provide: TiendanubeConnectionRepository,
      useClass: SupabaseTiendanubeConnectionRepository,
    },
  ],
  exports: [TiendanubeApiService],
})
export class TiendanubeModule {}
