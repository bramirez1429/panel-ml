import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MercadolibreModule } from '../mercadolibre/mercadolibre.module';
import { MercadoLibreReplicationNormalizerService } from '../tiendanube/replication/mercadolibre-replication-normalizer.service';
import { TiendaNegocioPreviewController } from './tiendanegocio-preview.controller';
import { TiendaNegocioPreviewService } from './tiendanegocio-preview.service';
import { TiendaNegocioApiClient } from './tiendanegocio-api.client';

@Module({
  imports: [AuthModule, MercadolibreModule],
  controllers: [TiendaNegocioPreviewController],
  providers: [
    MercadoLibreReplicationNormalizerService,
    TiendaNegocioPreviewService,
    TiendaNegocioApiClient,
  ],
})
export class TiendaNegocioModule {}
