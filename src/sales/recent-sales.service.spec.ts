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
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-15T15:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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
    expect(sales.findSince).toHaveBeenCalledWith(expect.any(Date));
  });

  it('dos usuarios reciben las mismas ventas compartidas y respeta hours=24', async () => {
    const sales = { findSince: jest.fn().mockResolvedValue([SALE]) };
    const curves = { getForSale: jest.fn().mockResolvedValue(VARIANTS) };
    const service = new RecentSalesService(
      sales as unknown as RecentSalesRepository,
      curves as unknown as SalesCurveService,
    );

    const first = await service.list('user-a', '24');
    const second = await service.list('user-b', '24');

    expect(first).toEqual(second);
    expect(first.hours).toBe(24);
    expect(sales.findSince).toHaveBeenNthCalledWith(
      1,
      new Date('2026-09-14T15:00:00.000Z'),
    );
    expect(sales.findSince).toHaveBeenNthCalledWith(
      2,
      new Date('2026-09-14T15:00:00.000Z'),
    );
  });

  it('devuelve variantes de una venta de otro usuario sin exponer userId', async () => {
    const sales = { findById: jest.fn().mockResolvedValue(SALE) };
    const curves = { getForSale: jest.fn().mockResolvedValue(VARIANTS) };
    const service = new RecentSalesService(
      sales as unknown as RecentSalesRepository,
      curves as unknown as SalesCurveService,
    );

    const result = await service.detail('user-b', SALE.id);

    expect(result.sale).not.toHaveProperty('userId');
    expect(result.variants).toEqual(VARIANTS);
    expect(sales.findById).toHaveBeenCalledWith(SALE.id);
    expect(curves.getForSale).toHaveBeenCalledWith('user-b', SALE);
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
