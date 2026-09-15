import { mapClassicItem, mapItemOffer } from './mercadolibre-curve.service';
import { mapTiendanubeProduct } from './tiendanube-curve.service';

describe('sales curve mappers', () => {
  it('incluye todas las variaciones clasicas de Mercado Libre con stock actual', () => {
    const result = mapClassicItem({
      id: 'MLA1491447379',
      family_id: '7452953254396627',
      variations: [
        {
          id: 100,
          available_quantity: 4,
          attributes: [{ id: 'SELLER_SKU', value_name: 'RM-NEG-S' }],
          attribute_combinations: [
            { id: 'COLOR', value_name: 'Negro' },
            { id: 'SIZE', value_name: 'S' },
          ],
        },
        {
          id: 101,
          available_quantity: 2,
          attributes: [{ id: 'SELLER_SKU', value_name: 'RM-NEG-M' }],
          attribute_combinations: [
            { id: 'COLOR', value_name: 'Negro' },
            { id: 'SIZE', value_name: 'M' },
          ],
        },
      ],
    });

    expect(result).toMatchObject([
      {
        sku: 'RM-NEG-S',
        color: 'Negro',
        size: 'S',
        ml: { variationId: '100', stock: 4 },
      },
      {
        sku: 'RM-NEG-M',
        color: 'Negro',
        size: 'M',
        ml: { variationId: '101', stock: 2 },
      },
    ]);
  });

  it('mapea una oferta de familia con familyId y userProductId', () => {
    expect(
      mapItemOffer(
        {
          id: 'MLA200',
          user_product_id: 'MLAU200',
          available_quantity: 3,
          attributes: [
            { id: 'COLOR', value_name: 'Blanco' },
            { id: 'SIZE', value_name: 'L' },
          ],
        },
        '7452953254396627',
      ),
    ).toMatchObject({
      color: 'Blanco',
      size: 'L',
      ml: {
        itemId: 'MLA200',
        variationId: null,
        userProductId: 'MLAU200',
        familyId: '7452953254396627',
        stock: 3,
      },
    });
  });

  it('incluye toda la curva Tiendanube respetando el orden de atributos', () => {
    const result = mapTiendanubeProduct(
      {
        id: 10,
        attributes: [{ es: 'Color' }, { es: 'Talle' }],
        variants: [
          { id: 20, sku: 'RM-NEG-S', values: ['Negro', 'S'], stock: 4 },
          { id: 21, sku: 'RM-NEG-M', values: ['Negro', 'M'], stock: 1 },
        ],
      },
      '10',
    );

    expect(result).toEqual([
      expect.objectContaining({
        sku: 'RM-NEG-S',
        color: 'Negro',
        size: 'S',
        tiendaNube: { productId: '10', variantId: '20', stock: 4 },
      }),
      expect.objectContaining({
        sku: 'RM-NEG-M',
        color: 'Negro',
        size: 'M',
        tiendaNube: { productId: '10', variantId: '21', stock: 1 },
      }),
    ]);
  });
});
