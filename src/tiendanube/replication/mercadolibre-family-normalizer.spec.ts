import { MercadoLibreToTiendanubeMapper } from './mercadolibre-to-tiendanube.mapper';
import { normalizeFamilyProduct } from './mercadolibre-family-normalizer';

describe('normalizeFamilyProduct', () => {
  it('normaliza 3 MLAU / 3 MLA con atributos e imágenes canónicas del User Product', () => {
    const result = normalizeFamilyProduct({
      userProductIds: ['MLAU1', 'MLAU2', 'MLAU3'],
      userProducts: [
        userProduct('MLAU1', 'Negro', 'S'),
        userProduct('MLAU2', 'Negro', 'M'),
        userProduct('MLAU3', 'Blanco', 'S'),
      ],
      offers: [
        offer('MLA1', 'MLAU1', 'Negro', 'S', 100, 2, 'SKU-1'),
        offer('MLA2', 'MLAU2', 'Negro', 'M', 110, 3, 'SKU-2'),
        offer('MLA3', 'MLAU3', 'Blanco', 'S', 120, 4, 'SKU-3'),
      ],
    });

    expect(result.attributes).toEqual([
      { id: 'COLOR', name: 'Color' },
      { id: 'SIZE', name: 'Talle' },
    ]);
    expect(result.variants).toHaveLength(3);
    expect(result.variants[0]).toMatchObject({
      price: 100,
      stock: 2,
      sku: 'SKU-1',
      imageSrc: 'https://img/MLAU1.jpg',
      values: [
        { attributeId: 'COLOR', value: 'Negro' },
        { attributeId: 'SIZE', value: 'S' },
      ],
    });
    expect(result.images).toEqual([
      'https://img/MLAU1.jpg',
      'https://img/MLAU2.jpg',
      'https://img/MLAU3.jpg',
      'https://img/shared.jpg',
    ]);
  });

  it('normaliza 3 MLAU / 4 MLA agrupando ofertas del mismo MLAU', () => {
    const result = normalizeFamilyProduct({
      userProductIds: ['MLAU1', 'MLAU2', 'MLAU3'],
      userProducts: [
        userProduct('MLAU1', 'Negro', 'S'),
        userProduct('MLAU2', 'Negro', 'M'),
        userProduct('MLAU3', 'Blanco', 'S'),
      ],
      offers: [
        offer('MLA1', 'MLAU1', 'Negro', 'S', 150, 2, 'SKU-A'),
        offer('MLA4', 'MLAU1', 'Negro', 'S', 120, 8, 'SKU-B'),
        offer('MLA2', 'MLAU2', 'Negro', 'M', 130, 3, 'SKU-2'),
        offer('MLA3', 'MLAU3', 'Blanco', 'S', 140, 4, 'SKU-3'),
      ],
    });

    expect(result.variants).toHaveLength(3);
    expect(result.variants[0]).toMatchObject({
      price: 120,
      stock: 8,
      sku: null,
    });
  });

  it('con múltiples ofertas de igual precio conserva SKU único y nunca suma stock', () => {
    const result = normalizeFamilyProduct({
      userProductIds: ['MLAU1'],
      userProducts: [userProduct('MLAU1', 'Negro', 'S')],
      offers: [
        offer('MLA1', 'MLAU1', 'Negro', 'S', 100, 4, 'SAME'),
        offer('MLA2', 'MLAU1', 'Negro', 'S', 100, 7, 'SAME'),
      ],
    });

    expect(result.variants).toEqual([
      {
        price: 100,
        stock: 7,
        sku: 'SAME',
        imageSrc: 'https://img/MLAU1.jpg',
        values: [],
      },
    ]);
  });

  it('un MLAU sin oferta actual no rompe el resto de la familia', () => {
    const result = normalizeFamilyProduct({
      userProductIds: ['MLAU1', 'MLAU2', 'MLAU3'],
      userProducts: [
        userProduct('MLAU1', 'Negro', 'S'),
        userProduct('MLAU2', 'Blanco', 'S'),
        userProduct('MLAU3', 'Rojo', 'S'),
      ],
      offers: [
        offer('MLA1', 'MLAU1', 'Negro', 'S', 100, 2, null),
        offer('MLA2', 'MLAU2', 'Blanco', 'S', 0, 3, null),
        offer('MLA3', 'MLAU3', 'Rojo', 'S', 120, 4, null),
      ],
    });

    expect(result.variants).toHaveLength(2);
    expect(result.variants.map(({ values }) => values[0]?.value)).toEqual([
      'Negro',
      'Rojo',
    ]);
  });

  it.each([
    ['Color', ['Negro', 'S'], ['Blanco', 'S'], ['COLOR']],
    ['Talle', ['Negro', 'S'], ['Negro', 'M'], ['SIZE']],
    ['Color + Talle', ['Negro', 'S'], ['Blanco', 'M'], ['COLOR', 'SIZE']],
  ])(
    'detecta %s y jamás genera values vacíos',
    (_label, first, second, expectedIds) => {
      const result = normalizeFamilyProduct({
        userProductIds: ['MLAU1', 'MLAU2'],
        userProducts: [],
        offers: [
          offer('MLA1', 'MLAU1', first[0], first[1], 100, 1, null),
          offer('MLA2', 'MLAU2', second[0], second[1], 100, 1, null),
        ],
      });

      expect(result.attributes.map(({ id }) => id)).toEqual(expectedIds);
      expect(
        result.variants.every(
          ({ values }) =>
            values.length === result.attributes.length &&
            values.every(({ value }) => value.trim().length > 0),
        ),
      ).toBe(true);
    },
  );

  it('atributos técnicos distintos no crean dimensiones ni duplican el MLAU', () => {
    const result = normalizeFamilyProduct({
      userProductIds: ['MLAU1'],
      userProducts: [],
      offers: [
        offer('MLA1', 'MLAU1', 'Negro', 'S', 100, 2, 'SKU-A'),
        offer('MLA2', 'MLAU1', 'Negro', 'S', 90, 4, 'SKU-B'),
      ],
    });

    expect(result.attributes).toEqual([]);
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].sku).toBeNull();
  });

  it('regresión: familias comerciales suficientes llegan al mapper sin errores históricos', () => {
    const normalized = normalizeFamilyProduct({
      userProductIds: ['MLAU1', 'MLAU2', 'MLAU-SIN-OFERTA'],
      userProducts: [
        userProduct('MLAU1', 'Negro', 'S'),
        userProduct('MLAU2', 'Blanco', 'M'),
      ],
      offers: [
        offer('MLA1', 'MLAU1', 'Negro', 'S', 150, 2, 'SKU-1'),
        offer('MLA2', 'MLAU1', 'Negro', 'S', 100, 5, 'SKU-1'),
        offer('MLA3', 'MLAU2', 'Blanco', 'M', 120, 3, 'SKU-2'),
      ],
    });

    expect(() => MercadoLibreToTiendanubeMapper.map(normalized)).not.toThrow(
      'No se pudo construir el producto para Tiendanube',
    );
    expect(normalized.variants).toHaveLength(2);
  });
});

function userProduct(id: string, color: string, size: string) {
  return {
    id,
    attributes: [
      userProductAttribute('COLOR', 'Color', color),
      userProductAttribute('SIZE', 'Talle', size),
    ],
    pictures: [
      { secure_url: `https://img/${id}.jpg` },
      { secure_url: 'https://img/shared.jpg' },
    ],
  };
}

function userProductAttribute(id: string, name: string, value: string) {
  return { id, name, values: [{ id: null, name: value }] };
}

function offer(
  itemId: string,
  userProductId: string,
  color: string,
  size: string,
  price: number,
  stock: number,
  sku: string | null,
) {
  return {
    description: 'Descripción familiar',
    item: {
      id: itemId,
      seller_id: 42,
      user_product_id: userProductId,
      title: 'Remera familiar',
      price,
      available_quantity: stock,
      attributes: [
        { id: 'COLOR', name: 'Color', value_name: color },
        { id: 'SIZE', name: 'Talle', value_name: size },
        { id: 'GTIN', name: 'GTIN', value_name: `GTIN-${itemId}` },
        ...(sku ? [{ id: 'SELLER_SKU', name: 'SKU', value_name: sku }] : []),
      ],
    },
  };
}
