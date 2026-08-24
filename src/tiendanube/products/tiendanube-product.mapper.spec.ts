import { BadGatewayException } from '@nestjs/common';

import { TiendanubeProductMapper } from './tiendanube-product.mapper';

const VALID_PRODUCT = {
  id: 1234,
  name: {
    es: 'Remera',
    pt: 'Camiseta',
  },
  published: true,
  variants: [
    {
      id: 101,
      sku: 'SKU-PRIVATE',
      stock: 5,
    },
  ],
  images: [
    {
      id: 201,
      src: 'https://example.com/product.jpg',
      position: 1,
      product_id: 1234,
    },
  ],
  access_token: 'must-not-leak',
};

describe('TiendanubeProductMapper', () => {
  it('valida y proyecta exclusivamente el contrato público', () => {
    const result = TiendanubeProductMapper.mapList([VALID_PRODUCT]);

    expect(result).toEqual([
      {
        id: 1234,
        name: {
          es: 'Remera',
          pt: 'Camiseta',
        },
        published: true,
        variants: [{ id: 101 }],
        images: [
          {
            id: 201,
            src: 'https://example.com/product.jpg',
            position: 1,
          },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /access_token|must-not-leak|SKU-PRIVATE|product_id/i,
    );
  });

  it('acepta listas y colecciones anidadas vacías', () => {
    expect(TiendanubeProductMapper.mapList([])).toEqual([]);
    expect(
      TiendanubeProductMapper.mapList([
        {
          id: 1,
          name: { es: 'Remera' },
          published: false,
          variants: [],
          images: [],
        },
      ]),
    ).toEqual([
      {
        id: 1,
        name: { es: 'Remera' },
        published: false,
        variants: [],
        images: [],
      },
    ]);
  });

  it.each([undefined, null, {}, 'products', { products: [VALID_PRODUCT] }])(
    'rechaza una raíz que no sea una lista JSON: %p',
    (value) => {
      expect(() => TiendanubeProductMapper.mapList(value)).toThrow(
        BadGatewayException,
      );
    },
  );

  it.each([
    { ...VALID_PRODUCT, id: '1234' },
    { ...VALID_PRODUCT, id: 0 },
    { ...VALID_PRODUCT, name: 'Remera' },
    { ...VALID_PRODUCT, name: {} },
    { ...VALID_PRODUCT, name: { es: 123 } },
    { ...VALID_PRODUCT, name: { es: '' } },
    { ...VALID_PRODUCT, name: { es: '   ' } },
    { ...VALID_PRODUCT, name: { access_token: 'secret' } },
    { ...VALID_PRODUCT, name: { 'es-ar': 'Remera' } },
    { ...VALID_PRODUCT, published: 'true' },
    { ...VALID_PRODUCT, variants: {} },
    { ...VALID_PRODUCT, images: {} },
  ])('rechaza campos de producto inválidos', (product) => {
    expect(() => TiendanubeProductMapper.mapList([product])).toThrow(
      BadGatewayException,
    );
  });

  it.each([
    { ...VALID_PRODUCT, variants: [null] },
    { ...VALID_PRODUCT, variants: [{ id: '101' }] },
    { ...VALID_PRODUCT, images: [null] },
    {
      ...VALID_PRODUCT,
      images: [{ id: 201, src: 123, position: 1 }],
    },
    {
      ...VALID_PRODUCT,
      images: [{ id: 201, src: '   ', position: 1 }],
    },
    {
      ...VALID_PRODUCT,
      images: [
        { id: 201, src: 'https://example.com/product.jpg', position: 0 },
      ],
    },
  ])('rechaza variantes o imágenes inválidas', (product) => {
    expect(() => TiendanubeProductMapper.mapList([product])).toThrow(
      BadGatewayException,
    );
  });

  it('usa un error genérico que no incluye el payload recibido', () => {
    const secret = 'private-upstream-value';

    let caught: unknown;
    try {
      TiendanubeProductMapper.mapList([
        { ...VALID_PRODUCT, name: { es: { secret } } },
      ]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      status: 502,
      message: 'Tiendanube devolvió una respuesta de productos inválida',
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
  });
});
