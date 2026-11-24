import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MercadolibreModule } from '../mercadolibre/mercadolibre.module';
import { TiendanubeModule } from '../tiendanube/tiendanube.module';
import { MercadolibreCurveService } from './mercadolibre-curve.service';
import { MercadolibreSalesBackfillService } from './mercadolibre-sales-backfill.service';
import { RecentSalesService } from './recent-sales.service';
import { SalesCurveService } from './sales-curve.service';
import { SalesSyncService } from './sales-sync.service';
import { SalesPersistenceModule } from './sales-persistence.module';
import { SalesController } from './sales.controller';
import { SalesOperationsController, SalesOperationsService } from './sales-operations.service';
import { SupabaseService } from '../database/supabase.service';
import { WorkspaceModule } from '../workspaces/workspace.module';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { VariantLinkService } from './variant-link.service';

@Module({
  imports: [
    AuthModule,
    MercadolibreModule,
    TiendanubeModule,
    SalesPersistenceModule,
    WorkspaceModule,
  ],
  controllers: [SalesController, SalesOperationsController],
  providers: [
    SupabaseService,
    SalesOperationsService,
    MercadolibreCurveService,
    MercadolibreSalesBackfillService,
    SalesSyncService,
    TiendanubeCurveService,
    SalesCurveService,
    RecentSalesService,
    VariantLinkService,
  ],
})
export class SalesModule {}
