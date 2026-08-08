import { Module } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreTokenService } from './auth/mercadolibre-token.service';
import { MercadolibreController } from './mercadolibre.controller';
import { PublicationGroupsService } from './publications/publication-groups.service';
import { PublicationsService } from './publications/publications.service';
import { MercadolibreApiService } from './shared/mercadolibre-api.service';
import { UserProductsService } from './user-products/user-products.service';

@Module({
  controllers: [MercadolibreController],
  providers: [
    SupabaseService,
    MercadolibreApiService,
    MercadolibreAuthService,
    MercadolibreTokenService,
    UserProductsService,
    PublicationGroupsService,
    PublicationsService,
  ],
})
export class MercadolibreModule {}
