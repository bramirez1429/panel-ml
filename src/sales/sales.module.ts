import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MercadolibreModule } from '../mercadolibre/mercadolibre.module';
import { TiendanubeModule } from '../tiendanube/tiendanube.module';
import { MercadolibreCurveService } from './mercadolibre-curve.service';
import { RecentSalesService } from './recent-sales.service';
import { SalesCurveService } from './sales-curve.service';
import { SalesPersistenceModule } from './sales-persistence.module';
import { SalesController } from './sales.controller';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { VariantLinkService } from './variant-link.service';

@Module({
  imports: [
    AuthModule,
    MercadolibreModule,
    TiendanubeModule,
    SalesPersistenceModule,
  ],
  controllers: [SalesController],
  providers: [
    MercadolibreCurveService,
    TiendanubeCurveService,
    SalesCurveService,
    RecentSalesService,
    VariantLinkService,
  ],
})
export class SalesModule {}
