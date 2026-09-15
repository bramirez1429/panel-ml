import { MercadolibreCurveService } from './mercadolibre-curve.service';
import { SalesCurveService } from './sales-curve.service';
import type {
  ChannelVariant,
  RecentSale,
  VariantChannelLink,
} from './sales.types';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { TiendanubeConnectionRepository } from '../tiendanube/connections/tiendanube-connection.repository';
import { TiendanubeProductLinkRepository } from '../tiendanube/replication/tiendanube-product-link.repository';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('SalesCurveService', () => {
  function setup(input?: {
    ml?: ChannelVariant[];
    tn?: ChannelVariant[];
    links?: VariantChannelLink[];
  }) {
    const mlCurve = {
      getBySourceKey: jest.fn().mockResolvedValue(input?.ml ?? []),
    };
    const tnCurve = {
      getForUser: jest.fn().mockResolvedValue(input?.tn ?? []),
    };
    const connections = {
      findCredentialsByUserId: jest.fn().mockResolvedValue({
        storeId: '99',
        accessToken: 'private-token',
        scope: 'write_products',
      }),
    };
    const productLinks = {
      findBySourceKey: jest.fn().mockResolvedValue({
        sourceKey: 'family:7452953254396627',
        tiendanubeProductId: '10',
        status: 'COMPLETED',
      }),
      findSourceKeyByTiendanubeProductId: jest.fn(),
    };
    const variantLinks = {
      findByUserId: jest.fn().mockResolvedValue(input?.links ?? []),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
    };
    const service = new SalesCurveService(
      mlCurve as unknown as MercadolibreCurveService,
      tnCurve as unknown as TiendanubeCurveService,
      connections as unknown as TiendanubeConnectionRepository,
      productLinks as unknown as TiendanubeProductLinkRepository,
      variantLinks,
    );
    return { service, mlCurve, tnCurve, variantLinks };
  }

  it('prioriza un vinculo persistido sobre SKU o atributos', async () => {
    const ml = [mlVariant('MLA1', '100', 'SKU-A', 'Negro', 'M', 4)];
    const tn = [
      tnVariant('10', '200', 'SKU-A', 'Negro', 'M', 7),
      tnVariant('10', '201', 'OTRO', 'Blanco', 'L', 4),
    ];
    const persisted = link('MLA1', '100', '10', '201');
    const { service, variantLinks } = setup({ ml, tn, links: [persisted] });

    const result = await service.getForSale(USER_ID, sale());

    expect(result[0]).toMatchObject({
      mappingStatus: 'LINKED',
      stockDifference: 0,
      tiendaNube: { variantId: '201' },
    });
    expect(variantLinks.save).not.toHaveBeenCalled();
  });

  it('auto-vincula por SKU exacto y persiste el resultado', async () => {
    const { service, variantLinks } = setup({
      ml: [mlVariant('MLA1', '100', 'RM-NEG-M', 'Negro', 'M', 2)],
      tn: [tnVariant('10', '200', 'RM-NEG-M', 'NEGRO', 'Medium', 1)],
    });

    const result = await service.getForSale(USER_ID, sale());

    expect(result).toEqual([
      expect.objectContaining({
        mappingStatus: 'AUTO_LINKED',
        stockDifference: 1,
        hasStockDifference: true,
        stockStatus: 'LOW',
      }),
    ]);
    expect(variantLinks.save).toHaveBeenCalledWith(
      expect.objectContaining({ matchSource: 'SKU', sku: 'RM-NEG-M' }),
    );
  });

  it('auto-vincula sin SKU solo ante una coincidencia inequivoca de atributos', async () => {
    const { service, variantLinks } = setup({
      ml: [mlVariant('MLA1', '100', null, 'Négro', 'Extra Grande', 3)],
      tn: [tnVariant('10', '200', null, 'NEGRO', 'XL', 3)],
    });

    const result = await service.getForSale(USER_ID, sale());

    expect(result[0].mappingStatus).toBe('AUTO_LINKED');
    expect(variantLinks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        matchSource: 'ATTRIBUTES',
        normalizedColor: 'negro',
        normalizedSize: 'xl',
      }),
    );
  });

  it('marca ambiguo sin elegir una variante al azar', async () => {
    const { service, variantLinks } = setup({
      ml: [mlVariant('MLA1', '100', null, 'Negro', 'M', 3)],
      tn: [
        tnVariant('10', '200', null, 'negro', 'M', 3),
        tnVariant('10', '201', null, 'NEGRO', 'Medium', 3),
      ],
    });

    const result = await service.getForSale(USER_ID, sale());

    expect(result[0]).toMatchObject({
      mappingStatus: 'AMBIGUOUS',
      tiendaNube: null,
      stockDifference: null,
    });
    expect(variantLinks.save).not.toHaveBeenCalled();
  });

  it('reutiliza durante el TTL la promesa de la curva completa', async () => {
    const { service, mlCurve, tnCurve } = setup({
      ml: [mlVariant('MLA1', '100', 'SKU-A', 'Negro', 'M', 3)],
      tn: [tnVariant('10', '200', 'SKU-A', 'Negro', 'M', 3)],
    });

    await Promise.all([
      service.getForSale(USER_ID, sale()),
      service.getForSale(USER_ID, sale()),
    ]);

    expect(mlCurve.getBySourceKey).toHaveBeenCalledTimes(1);
    expect(tnCurve.getForUser).toHaveBeenCalledTimes(1);
  });
});

function sale(): RecentSale {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: USER_ID,
    channel: 'MERCADOLIBRE',
    externalOrderId: '1',
    externalOrderItemId: '2',
    soldAt: '2026-09-14T12:00:00.000Z',
    quantity: 1,
    productName: 'Remera',
    sku: 'RM-NEG-M',
    mlItemId: 'MLA1',
    mlVariationId: '100',
    userProductId: 'MLAU1',
    familyId: '7452953254396627',
    tnProductId: null,
    tnVariantId: null,
    color: 'Negro',
    size: 'M',
    mappingStatus: 'UNLINKED',
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
  };
}

function mlVariant(
  itemId: string,
  variationId: string,
  sku: string | null,
  color: string,
  size: string,
  stock: number,
): ChannelVariant {
  return {
    sku,
    color,
    size,
    ml: {
      itemId,
      variationId,
      userProductId: 'MLAU1',
      familyId: '7452953254396627',
      stock,
    },
    tiendaNube: null,
  };
}

function tnVariant(
  productId: string,
  variantId: string,
  sku: string | null,
  color: string,
  size: string,
  stock: number,
): ChannelVariant {
  return {
    sku,
    color,
    size,
    ml: null,
    tiendaNube: { productId, variantId, stock },
  };
}

function link(
  mlItemId: string,
  mlVariationId: string,
  tnProductId: string,
  tnVariantId: string,
): VariantChannelLink {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    userId: USER_ID,
    mlItemId,
    mlVariationId,
    userProductId: 'MLAU1',
    familyId: '7452953254396627',
    tnProductId,
    tnVariantId,
    sku: null,
    normalizedColor: null,
    normalizedSize: null,
    matchSource: 'MANUAL',
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
  };
}
