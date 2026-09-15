import { BadRequestException } from '@nestjs/common';
import { RecentSalesRepository } from './recent-sales.repository';
import { RecentSalesService } from './recent-sales.service';
import { SalesCurveService } from './sales-curve.service';
import type { DetailedVariant, RecentSale } from './sales.types';

const SALE: RecentSale = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-a',
  channel: 'MERCADOLIBRE',
  externalOrderId: '1',
  externalOrderItemId: '2',
  soldAt: '2026-09-14T12:00:00.000Z',
  quantity: 1,
  productName: 'Remera',
  sku: 'RM-NEG-M',
  mlItemId: 'MLA1491447379',
  mlVariationId: '123456789',
  userProductId: 'MLAU123',
  familyId: '7452953254396627',
  tnProductId: '10',
  tnVariantId: '20',
  color: 'Negro',
  size: 'M',
  mappingStatus: 'LINKED',
  createdAt: '2026-09-14T12:00:00.000Z',
  updatedAt: '2026-09-14T12:00:00.000Z',
};

const VARIANTS: DetailedVariant[] = [
  {
    sku: 'RM-NEG-M',
    color: 'Negro',
    size: 'M',
    ml: {
      itemId: 'MLA1491447379',
      variationId: '123456789',
      userProductId: 'MLAU123',
      familyId: '7452953254396627',
      stock: 2,
    },
    tiendaNube: { productId: '10', variantId: '20', stock: 1 },
    difference: 1,
    stockDifference: 1,
    hasStockDifference: true,
    mappingStatus: 'LINKED',
    stockStatus: 'LOW',
  },
];

describe('RecentSalesService', () => {
  it('usa 48 horas por defecto y resume con stock actual', async () => {
    const sales = {
      findSince: jest.fn().mockResolvedValue([SALE]),
    };
    const curves = { getForSale: jest.fn().mockResolvedValue(VARIANTS) };
    const service = new RecentSalesService(
      sales as unknown as RecentSalesRepository,
      curves as unknown as SalesCurveService,
    );

    const result = await service.list('user-a');

    expect(result).toEqual({
      hours: 48,
      items: [
        expect.objectContaining({
          saleId: SALE.id,
          mlStock: 2,
          tiendaNubeStock: 1,
          stockDifference: 1,
          hasStockDifference: true,
          lowStockCount: 1,
        }),
      ],
    });
    expect(sales.findSince).toHaveBeenCalledWith('user-a', expect.any(Date));
  });

  it('devuelve la curva completa en el detalle sin exponer userId', async () => {
    const sales = { findById: jest.fn().mockResolvedValue(SALE) };
    const curves = { getForSale: jest.fn().mockResolvedValue(VARIANTS) };
    const service = new RecentSalesService(
      sales as unknown as RecentSalesRepository,
      curves as unknown as SalesCurveService,
    );

    const result = await service.detail('user-a', SALE.id);

    expect(result.sale).not.toHaveProperty('userId');
    expect(result.variants).toEqual(VARIANTS);
  });

  it.each(['0', '745', '2.5', 'no'])(
    'rechaza hours invalido: %s',
    async (hours) => {
      const service = new RecentSalesService(
        {} as RecentSalesRepository,
        {} as SalesCurveService,
      );

      await expect(service.list('user-a', hours)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
});
