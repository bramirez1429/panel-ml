import type { LiveAttribute } from './publication-management.types';
import { replaceSellerSku } from './publication-management.types';

describe('replaceSellerSku', () => {
  it('limpia la representacion anterior del SKU y preserva los demas atributos', () => {
    const attributes: LiveAttribute[] = [
      {
        id: 'GTIN',
        value_name: '7791234567890',
        value_id: 'GTIN-ID',
        value_struct: { number: 7791234567890 },
        values: [{ id: 'GTIN-ID', name: '7791234567890' }],
      },
      {
        id: 'SELLER_SKU',
        value_name: 'SKU-ANTERIOR',
        value_id: 'SKU-ID',
        value_struct: { number: 1 },
        values: [{ id: 'SKU-ID', name: 'SKU-ANTERIOR' }],
      },
      { id: 'COLOR', value_name: 'Negro' },
    ];

    expect(replaceSellerSku(attributes, 'SKU-NUEVO')).toEqual([
      {
        id: 'GTIN',
        value_name: '7791234567890',
        value_id: 'GTIN-ID',
        value_struct: { number: 7791234567890 },
        values: [{ id: 'GTIN-ID', name: '7791234567890' }],
      },
      { id: 'SELLER_SKU', value_name: 'SKU-NUEVO' },
      { id: 'COLOR', value_name: 'Negro' },
    ]);
    expect(attributes[1]).toMatchObject({
      value_name: 'SKU-ANTERIOR',
      value_id: 'SKU-ID',
      value_struct: { number: 1 },
      values: [{ id: 'SKU-ID', name: 'SKU-ANTERIOR' }],
    });
  });

  it('agrega SELLER_SKU sin modificar los atributos existentes', () => {
    const attributes: LiveAttribute[] = [
      { id: 'GTIN', value_name: '7791234567890' },
    ];

    expect(replaceSellerSku(attributes, 'SKU-NUEVO')).toEqual([
      { id: 'GTIN', value_name: '7791234567890' },
      { id: 'SELLER_SKU', value_name: 'SKU-NUEVO' },
    ]);
    expect(attributes).toEqual([{ id: 'GTIN', value_name: '7791234567890' }]);
  });
});
