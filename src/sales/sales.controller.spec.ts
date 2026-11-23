import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { RecentSalesService } from './recent-sales.service';
import { MercadolibreCurveService } from './mercadolibre-curve.service';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { SalesController } from './sales.controller';
import { SalesSyncService } from './sales-sync.service';
import { VariantLinkService } from './variant-link.service';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

describe('SalesController', () => {
  it('consulta el mismo SKU en ambos canales e informa errores sin inventar ausencias', async () => {
    const ml = { findBySku: jest.fn().mockResolvedValue([
      { itemId: 'MLA123', variationId: null, title: 'Remera',
        color: 'Negro', size: 'M', sku: 'SKU-1', stock: 2 },
    ]) };
    const tn = { findBySku: jest.fn().mockRejectedValue(new Error('API no disponible')) };
    const controller = new SalesController(
      {} as RecentSalesService,
      {} as VariantLinkService,
      {} as SalesSyncService,
      {} as VariantChannelLinksRepository,
      ml as unknown as MercadolibreCurveService,
      tn as unknown as TiendanubeCurveService,
    );
    const user = { id: 'user-a' } as Parameters<SalesController['findStockBySku']>[0];
    await expect(controller.findStockBySku(user, ' SKU-1 ')).resolves.toEqual({
      sku: 'SKU-1',
      mercadoLibre: { error: false, variants: [
        expect.objectContaining({ itemId: 'MLA123', sku: 'SKU-1' }),
      ] },
      tiendanube: { error: true, variants: [] },
    });
    expect(ml.findBySku).toHaveBeenCalledWith('user-a', 'SKU-1');
    expect(tn.findBySku).toHaveBeenCalledWith('user-a', 'SKU-1');
    await expect(controller.findStockBySku(user, ' ')).rejects.toThrow(
      'Ingresá un SKU válido',
    );
  });

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
      {} as VariantChannelLinksRepository,
      {} as MercadolibreCurveService,
      {} as TiendanubeCurveService,
    );

    expect(controller).toBeInstanceOf(SalesController);
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SalesController,
    ) as unknown[];
    expect(guards).toEqual([AccessTokenGuard]);
  });
});
