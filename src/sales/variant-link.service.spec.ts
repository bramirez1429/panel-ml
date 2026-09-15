import { MercadolibreCurveService } from './mercadolibre-curve.service';
import { SalesCurveService } from './sales-curve.service';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';
import { VariantLinkService } from './variant-link.service';

describe('VariantLinkService', () => {
  it('valida IDs reales en ambos canales y guarda solo el vinculo', async () => {
    const mlCurve = {
      getForSale: jest.fn().mockResolvedValue([
        {
          sku: null,
          color: 'Negro',
          size: 'M',
          ml: {
            itemId: 'MLA1491447379',
            variationId: '123456789',
            userProductId: 'MLAU123',
            familyId: '7452953254396627',
            stock: 2,
          },
          tiendaNube: null,
        },
      ]),
    };
    const tnCurve = {
      getForUser: jest.fn().mockResolvedValue([
        {
          sku: 'RM-NEG-M',
          color: 'NEGRO',
          size: 'Medium',
          ml: null,
          tiendaNube: { productId: '10', variantId: '20', stock: 2 },
        },
      ]),
    };
    const saved = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: 'user-a',
      mlItemId: 'MLA1491447379',
      mlVariationId: '123456789',
      userProductId: 'MLAU123',
      familyId: '7452953254396627',
      tnProductId: '10',
      tnVariantId: '20',
      sku: 'RM-NEG-M',
      normalizedColor: 'negro',
      normalizedSize: 'm',
      matchSource: 'MANUAL' as const,
      createdAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T12:00:00.000Z',
    };
    const links = { save: jest.fn().mockResolvedValue(saved) };
    const curves = { invalidate: jest.fn() };
    const service = new VariantLinkService(
      mlCurve as unknown as MercadolibreCurveService,
      tnCurve as unknown as TiendanubeCurveService,
      links as unknown as VariantChannelLinksRepository,
      curves as unknown as SalesCurveService,
    );

    await expect(
      service.create('user-a', {
        mlItemId: 'MLA1491447379',
        mlVariationId: '123456789',
        tnProductId: '10',
        tnVariantId: '20',
      }),
    ).resolves.toEqual(saved);
    expect(links.save).toHaveBeenCalledWith({
      userId: 'user-a',
      mlItemId: 'MLA1491447379',
      mlVariationId: '123456789',
      userProductId: 'MLAU123',
      familyId: '7452953254396627',
      tnProductId: '10',
      tnVariantId: '20',
      sku: 'RM-NEG-M',
      normalizedColor: 'negro',
      normalizedSize: 'm',
      matchSource: 'MANUAL',
    });
    expect(curves.invalidate).toHaveBeenCalledWith('user-a');
  });
});
