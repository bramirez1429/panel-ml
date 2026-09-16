import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { RecentSalesService } from './recent-sales.service';
import { SalesController } from './sales.controller';
import { SalesSyncService } from './sales-sync.service';
import { VariantLinkService } from './variant-link.service';

describe('SalesController', () => {
  it('mantiene las lecturas de ventas protegidas por AccessTokenGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SalesController,
    ) as unknown[];

    expect(guards).toContain(AccessTokenGuard);
  });

  it('no requiere un guard de administrador para listar ni ver detalle', () => {
    const controller = new SalesController(
      {} as RecentSalesService,
      {} as VariantLinkService,
      {} as SalesSyncService,
    );

    expect(controller).toBeInstanceOf(SalesController);
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SalesController,
    ) as unknown[];
    expect(guards).toEqual([AccessTokenGuard]);
  });
});
