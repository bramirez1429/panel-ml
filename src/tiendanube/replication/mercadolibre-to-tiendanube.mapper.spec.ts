import { BadGatewayException } from '@nestjs/common';

import { MercadoLibreToTiendanubeMapper } from './mercadolibre-to-tiendanube.mapper';
import type { ReplicableProduct } from './tiendanube-replication.types';

const COLOR_TALLE_PRODUCT: ReplicableProduct = {
  description:
    '  Primera & <b>"doble" y \'simple\'</b>\r\nSegunda\rTercera\nCuarta con <br> literal  ',
  title: '  Remera clásica  ',
  images: [' https://images.example.com/remera.jpg '],
  attributes: [
    { id: 'COLOR', name: 'Color' },
    { id: 'SIZE', name: 'Talle' },
  ],
  variants: [
    {
      price: 38_000,
      stock: 5,
      sku: ' SKU-NEGRO-38 ',
      values: [
        { attributeId: 'SIZE', value: ' 38 ' },
        { attributeId: 'COLOR', value: ' Negro ' },
      ],
    },
    {
      price: 39_500.5,
      stock: 0,
      sku: 'SKU-BLANCO-40',
      values: [
        { attributeId: 'COLOR', value: 'Blanco' },
        { attributeId: 'SIZE', value: '40' },
      ],
    },
  ],
};

describe('MercadoLibreToTiendanubeMapper', () => {
  it('mapea Color/Talle en el orden de atributos y crea el producto oculto', () => {
    const result = MercadoLibreToTiendanubeMapper.map(COLOR_TALLE_PRODUCT);

    expect(result).toEqual({
      name: { es: 'Remera clásica' },
      description: {
        es: 'Primera &amp; &lt;b&gt;&quot;doble&quot; y &#39;simple&#39;&lt;/b&gt;<br>Segunda<br>Tercera<br>Cuarta con &lt;br&gt; literal',
      },
      visibility: 'hidden',
      images: [{ src: 'https://images.example.com/remera.jpg' }],
      attributes: [{ es: 'Color' }, { es: 'Talle' }],
      variants: [
        {
          price: '38000.00',
          stock_management: true,
          stock: 5,
          sku: 'SKU-NEGRO-38',
          values: [{ es: 'Negro' }, { es: '38' }],
        },
        {
          price: '39500.50',
          stock_management: true,
          stock: 0,
          sku: 'SKU-BLANCO-40',
          values: [{ es: 'Blanco' }, { es: '40' }],
        },
      ],
    });
    expect(result).not.toHaveProperty('published');
  });

  it.each([
    ['null', null],
    ['vacía', ''],
    ['sólo espacios', ' \r\n\t '],
  ])('omite una descripción %s', (_case, description) => {
    const result = MercadoLibreToTiendanubeMapper.map({
      ...COLOR_TALLE_PRODUCT,
      description,
    });

    expect(result).not.toHaveProperty('description');
    expect(result.visibility).toBe('hidden');
    expect(result).not.toHaveProperty('published');
  });

  it.each([undefined, 123, {}, []])(
    'rechaza una descripción no nullable/string: %p',
    (description) => {
      expectControlledFailure({ ...COLOR_TALLE_PRODUCT, description });
    },
  );

  it('deduplica imágenes conservando orden y limita el DTO a nueve', () => {
    const uniqueImages = Array.from(
      { length: 10 },
      (_, index) => `https://images.example.com/${index + 1}.jpg`,
    );
    const result = MercadoLibreToTiendanubeMapper.map({
      ...COLOR_TALLE_PRODUCT,
      images: [
        uniqueImages[0],
        uniqueImages[1],
        ` ${uniqueImages[0]} `,
        ...uniqueImages.slice(2),
      ],
    });

    expect(result.images).toEqual(
      uniqueImages.slice(0, 9).map((src) => ({ src })),
    );
    expect(result.images).toHaveLength(9);
  });

  it.each([
    ['null', null],
    ['vacío', ''],
    ['sólo espacios', '   '],
  ])('omite un SKU %s porque no es un valor real', (_case, sku) => {
    const result = MercadoLibreToTiendanubeMapper.map({
      title: 'Producto simple',
      description: null,
      images: [],
      attributes: [],
      variants: [{ price: 1234.5, stock: 0, sku, values: [] }],
    });

    expect(result).toEqual({
      name: { es: 'Producto simple' },
      visibility: 'hidden',
      images: [],
      attributes: [],
      variants: [{ price: '1234.50', stock_management: true, stock: 0 }],
    });
    expect(result.variants[0]).not.toHaveProperty('sku');
    expect(result.variants[0]).not.toHaveProperty('values');
  });

  it.each([
    ['vacío', ''],
    ['sólo espacios', '   '],
    ['no string', 123],
  ])('rechaza un título %s', (_case, title) => {
    expectControlledFailure({ ...COLOR_TALLE_PRODUCT, title });
  });

  it('rechaza más de tres atributos', () => {
    expectControlledFailure({
      ...COLOR_TALLE_PRODUCT,
      attributes: [
        ...COLOR_TALLE_PRODUCT.attributes,
        { id: 'GENDER', name: 'Género' },
        { id: 'MATERIAL', name: 'Material' },
      ],
    });
  });

  it.each([
    ['un atributo faltante', [{ attributeId: 'COLOR', value: 'Negro' }]],
    [
      'un atributo distinto',
      [
        { attributeId: 'COLOR', value: 'Negro' },
        { attributeId: 'BRAND', value: 'ACME' },
      ],
    ],
    [
      'un atributo duplicado',
      [
        { attributeId: 'COLOR', value: 'Negro' },
        { attributeId: 'COLOR', value: '38' },
      ],
    ],
  ])('rechaza values con %s', (_case, values) => {
    expectControlledFailure({
      ...COLOR_TALLE_PRODUCT,
      variants: [{ ...COLOR_TALLE_PRODUCT.variants[0], values }],
    });
  });

  it('rechaza dos variantes con la misma combinación', () => {
    const variant = COLOR_TALLE_PRODUCT.variants[0];

    expectControlledFailure({
      ...COLOR_TALLE_PRODUCT,
      variants: [variant, { ...variant, sku: 'OTRO-SKU' }],
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rechaza el precio inválido %p',
    (price) => {
      expectControlledFailure({
        ...COLOR_TALLE_PRODUCT,
        variants: [{ ...COLOR_TALLE_PRODUCT.variants[0], price }],
      });
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rechaza el stock inválido %p',
    (stock) => {
      expectControlledFailure({
        ...COLOR_TALLE_PRODUCT,
        variants: [{ ...COLOR_TALLE_PRODUCT.variants[0], stock }],
      });
    },
  );

  it.each([
    ['sin variantes', []],
    ['variantes no array', null],
  ])('rechaza un producto %s', (_case, variants) => {
    expectControlledFailure({ ...COLOR_TALLE_PRODUCT, variants });
  });

  it('usa una excepción controlada sin reflejar el dominio inválido', () => {
    const privateValue = 'private-upstream-value';
    let caught: unknown;

    try {
      MercadoLibreToTiendanubeMapper.map({
        ...COLOR_TALLE_PRODUCT,
        title: privateValue,
        variants: [{ ...COLOR_TALLE_PRODUCT.variants[0], price: 0 }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadGatewayException);
    expect(caught).toMatchObject({
      status: 502,
      message: 'No se pudo construir el producto para Tiendanube',
    });
    expect(JSON.stringify(caught)).not.toContain(privateValue);
  });
});

function expectControlledFailure(value: unknown): void {
  expect(() => MercadoLibreToTiendanubeMapper.map(value)).toThrow(
    BadGatewayException,
  );
}
