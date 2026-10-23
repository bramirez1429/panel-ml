import { BadRequestException } from '@nestjs/common';
import type { ReplicableProduct } from '../../tiendanube/replication/tiendanube-replication.types';
import { MercadoLibreToTiendaNegocioMapper } from './mercadolibre-to-tiendanegocio.mapper';

const source: ReplicableProduct = {
  title: 'Remera Mujer Algodón Peinado',
  description: 'Liviana y suave al tacto',
  images: ['https://example.com/reme.jpg'],
  attributes: [{ id: 'COLOR', name: 'Color' }, { id: 'SIZE', name: 'Talle' }],
  variants: [
    { price: 45000, stock: 0, sku: 'SAEL-NEGRO-S', values: [
      { attributeId: 'COLOR', value: 'Negro' },
      { attributeId: 'SIZE', value: 'S' },
    ] },
    { price: 49000, stock: 8, sku: 'SAEL-CREMA-M', values: [
      { attributeId: 'COLOR', value: 'Crema' },
      { attributeId: 'SIZE', value: 'M' },
    ] },
  ],
};

describe('MercadoLibreToTiendaNegocioMapper', () => {
  it('conserva stock cero, precios por variante, SKUs y atributos ordenados', () => {
    const payload = MercadoLibreToTiendaNegocioMapper.map(source);
    expect(payload).toMatchObject({
      published: false,
      properties: [
        { title: 'Color', values: [{ id: 'A1-V1', title: 'Negro' }, { id: 'A1-V2', title: 'Crema' }] },
        { title: 'Talle', values: [{ id: 'A2-V1', title: 'S' }, { id: 'A2-V2', title: 'M' }] },
      ],
      variants: [
        { price: '45000', stock: 0, sku: 'SAEL-NEGRO-S', published: false,
          properties: [{ id: 'A1-V1', title: 'Negro' }, { id: 'A2-V1', title: 'S' }] },
        { price: '49000', stock: 8, sku: 'SAEL-CREMA-M', published: false },
      ],
    });
    expect('images' in payload).toBe(false);
  });

  it('adapta una publicación clásica sin variantes', () => {
    const payload = MercadoLibreToTiendaNegocioMapper.map({
      ...source, attributes: [], variants: [{
        price: 45000, stock: 4, sku: 'MLA100',
        values: [],
      }],
    });
    expect(payload).toMatchObject({ price: '45000', stock: 4, sku: 'MLA100' });
    expect(payload.variants).toBeUndefined();
  });

  it('rechaza variantes con stock incorrecto o atributos incompatibles', () => {
    expect(() => MercadoLibreToTiendaNegocioMapper.map({
      ...source, variants: [{ ...source.variants[0], stock: -1 }],
    })).toThrow(BadRequestException);
    expect(() => MercadoLibreToTiendaNegocioMapper.map({
      ...source, variants: [{ ...source.variants[0], values: [] }],
    })).toThrow(BadRequestException);
  });
});
