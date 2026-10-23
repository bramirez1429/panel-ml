import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../database/supabase.service';
import { TiendaNegocioOAuthService } from './auth/tiendanegocio-oauth.service';
import { TiendaNegocioConnectionRepository } from './connections/tiendanegocio-connection.repository';
import { MercadolibreModule } from '../mercadolibre/mercadolibre.module';
import { TiendanubeModule } from '../tiendanube/tiendanube.module';
import { TiendaNegocioCatalogService } from './catalog/tiendanegocio-catalog.service';
import { TiendaNegocioPreviewService } from './products/tiendanegocio-preview.service';
import { TiendaNegocioImageService } from './images/tiendanegocio-image.service';
import { TiendaNegocioApiService } from './shared/tiendanegocio-api.service';
import { TiendaNegocioController } from './tiendanegocio.controller';

@Module({
  imports: [AuthModule, MercadolibreModule, TiendanubeModule],
  controllers: [TiendaNegocioController],
  providers: [
    SupabaseService,
    TiendaNegocioCatalogService,
    TiendaNegocioApiService,
    TiendaNegocioPreviewService,
    TiendaNegocioImageService,
    TiendaNegocioConnectionRepository,
    TiendaNegocioOAuthService,
  ],
  exports: [TiendaNegocioApiService],
})
export class TiendaNegocioModule {}
