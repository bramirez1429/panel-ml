import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MercadolibreModule } from '../mercadolibre/mercadolibre.module';
import { TiendanubeModule } from '../tiendanube/tiendanube.module';
import { TiendaNegocioCatalogService } from './catalog/tiendanegocio-catalog.service';
import { TiendaNegocioApiService } from './shared/tiendanegocio-api.service';
import { TiendaNegocioController } from './tiendanegocio.controller';

@Module({
  imports: [AuthModule, MercadolibreModule, TiendanubeModule],
  controllers: [TiendaNegocioController],
  providers: [TiendaNegocioCatalogService, TiendaNegocioApiService],
  exports: [TiendaNegocioApiService],
})
export class TiendaNegocioModule {}
