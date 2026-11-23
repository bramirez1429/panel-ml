import { MercadolibreCurveService } from './mercadolibre-curve.service';
import { SalesCurveService } from './sales-curve.service';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';
import { VariantLinkService } from './variant-link.service';

describe('VariantLinkService', () => {
  it('vincula sólo SKU iguales en ambos canales', async () => {
    const mlCurve = {
      getForSale: jest.fn().mockResolvedValue([
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
      matchSource: 'SKU' as const,
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
      matchSource: 'SKU',
    });
    expect(curves.invalidate).toHaveBeenCalledWith('user-a');
  });

  it('rechaza SKU distintos y evita guardar el vínculo', async () => {
    const mlCurve = {
      getForSale: jest.fn().mockResolvedValue([{
        sku: 'ML-SKU', color: 'Negro', size: 'M',
        ml: { itemId: 'MLA123', variationId: '123', userProductId: null, familyId: null, stock: 2 },
        tiendaNube: null,
      }]),
    };
    const tnCurve = {
      getForUser: jest.fn().mockResolvedValue([{
        sku: 'TN-SKU', color: 'Negro', size: 'M',
        ml: null, tiendaNube: { productId: '10', variantId: '20', stock: 2 },
      }]),
    };
    const links = { save: jest.fn() };
    const curves = { invalidate: jest.fn() };
    const service = new VariantLinkService(
      mlCurve as unknown as MercadolibreCurveService,
      tnCurve as unknown as TiendanubeCurveService,
      links as unknown as VariantChannelLinksRepository,
      curves as unknown as SalesCurveService,
    );
    await expect(service.create('user-a', {
      mlItemId: 'MLA123', mlVariationId: '123', tnProductId: '10', tnVariantId: '20',
    })).rejects.toThrow('Los SKU de Mercado Libre y Tiendanube deben ser iguales');
    expect(links.save).not.toHaveBeenCalled();
    expect(curves.invalidate).not.toHaveBeenCalled();
  });
});
