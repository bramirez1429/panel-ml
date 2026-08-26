import { normalizeLegacyProduct } from './mercadolibre-legacy-normalizer';

describe('normalizeLegacyProduct', () => {
  it('normaliza un ITEM simple sin variations', () => {
    const result = normalizeLegacyProduct(
      {
        id: 'MLA1',
        title: 'Producto simple',
        price: 1500,
        available_quantity: 4,
        attributes: [skuAttribute('SIMPLE-1')],
        pictures: [{ id: 'PIC-1', secure_url: 'https://img/simple.jpg' }],
      },
      'Descripción simple',
    );

    expect(result).toMatchObject({
      title: 'Producto simple',
      description: 'Descripción simple',
      images: ['https://img/simple.jpg'],
      attributes: [],
      variants: [{ price: 1500, stock: 4, sku: 'SIMPLE-1', values: [] }],
    });
  });

  it('normaliza LEGACY con variations vacío como una variante simple', () => {
    const result = normalizeLegacyProduct(
      {
        id: 'MLA2',
        title: 'Legacy simple',
        price: 2000,
        available_quantity: 0,
        attributes: [],
        pictures: [],
        variations: [],
      },
      null,
    );

    expect(result.variants).toEqual([
      { price: 2000, stock: 0, sku: null, values: [] },
    ]);
  });

  it('usa únicamente attribute_combinations reales para Color y Talle', () => {
    const result = normalizeLegacyProduct(
      legacyItem([
        variation('Negro', 'S', 10, 2, 'NEG-S', 'PIC-B'),
        variation('Negro', 'M', 0, 3, 'NEG-M', 'PIC-A'),
        variation('Blanco', 'S', 12, 1, null, 'PIC-B'),
      ]),
      null,
    );

    expect(result.attributes).toEqual([
      { id: 'COLOR', name: 'Color' },
      { id: 'SIZE', name: 'Talle' },
    ]);
    expect(result.variants).toEqual([
      {
        price: 10,
        stock: 2,
        sku: 'NEG-S',
        imageSrc: 'https://img/b.jpg',
        values: [
          { attributeId: 'COLOR', value: 'Negro' },
          { attributeId: 'SIZE', value: 'S' },
        ],
      },
      {
        price: 99,
        stock: 3,
        sku: 'NEG-M',
        imageSrc: 'https://img/a.jpg',
        values: [
          { attributeId: 'COLOR', value: 'Negro' },
          { attributeId: 'SIZE', value: 'M' },
        ],
      },
      {
        price: 12,
        stock: 1,
        sku: null,
        imageSrc: 'https://img/b.jpg',
        values: [
          { attributeId: 'COLOR', value: 'Blanco' },
          { attributeId: 'SIZE', value: 'S' },
        ],
      },
    ]);
  });

  it('prioriza imágenes referidas por picture_ids y nunca las asigna por índice', () => {
    const result = normalizeLegacyProduct(
      legacyItem([
        variation('Negro', 'S', 10, 2, null, 'PIC-B'),
        variation('Blanco', 'S', 12, 1, null, 'PIC-A'),
      ]),
      null,
    );

    expect(result.images).toEqual(['https://img/b.jpg', 'https://img/a.jpg']);
    expect(result.variants.map(({ imageSrc }) => imageSrc)).toEqual([
      'https://img/b.jpg',
      'https://img/a.jpg',
    ]);
  });
});

function legacyItem(variations: unknown[]) {
  return {
    id: 'MLA3',
    title: 'Remera legacy',
    price: 99,
    available_quantity: 6,
    attributes: [],
    pictures: [
      { id: 'PIC-A', secure_url: 'https://img/a.jpg' },
      { id: 'PIC-B', secure_url: 'https://img/b.jpg' },
    ],
    variations,
  };
}

function variation(
  color: string,
  size: string,
  price: number | undefined,
  stock: number,
  sku: string | null,
  pictureId: string,
) {
  return {
    price,
    available_quantity: stock,
    picture_ids: [pictureId],
    attribute_combinations: [
      { id: 'COLOR', name: 'Color', value_name: color },
      { id: 'SIZE', name: 'Talle', value_name: size },
    ],
    attributes: [
      ...(sku ? [skuAttribute(sku)] : []),
      { id: 'BRAND', name: 'Marca', value_name: `Marca ${color}` },
    ],
  };
}

function skuAttribute(value: string) {
  return { id: 'SELLER_SKU', name: 'SKU', value_name: value };
}
