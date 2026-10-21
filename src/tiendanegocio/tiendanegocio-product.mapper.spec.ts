import { mapMercadoLibreToTiendaNegocio } from './tiendanegocio-product.mapper';
import type { ReplicableProduct } from '../tiendanube/replication/tiendanube-replication.types';

const source: ReplicableProduct = {
  title: 'Remera SAEL',
  description: 'Algodón <peinado>',
  images: ['https://images.example.com/1.jpg'],
  attributes: [
    { id: 'COLOR', name: 'Color' },
    { id: 'TALLE', name: 'Talle' },
  ],
  variants: [
    {
      price: 39900, stock: 4, sku: 'SAEL-NEGRO-M',
      values: [
        { attributeId: 'TALLE', value: 'M' },
        { attributeId: 'COLOR', value: 'Negro' },
      ],
    },
    {
      price: 39900, stock: 0, sku: 'SAEL-BLANCO-L',
      values: [
        { attributeId: 'COLOR', value: 'Blanco' },
        { attributeId: 'TALLE', value: 'L' },
      ],
    },
  ],
};

describe('mapMercadoLibreToTiendaNegocio', () => {
  it('preserva talles, colores, SKU y stock sin publicar', () => {
    const result = mapMercadoLibreToTiendaNegocio(source);
    expect(result.readyForImport).toBe(true);
    expect(result.product.published).toBe(false);
    expect(result.product.variants).toHaveLength(2);
    expect(result.product.variants?.[0]).toMatchObject({
      price: '39900.00', stock: 4, sku: 'SAEL-NEGRO-M', published: false,
      properties: [{ title: 'Negro' }, { title: 'M' }],
    });
    expect(result.product.description?.es).toBe('Algodón &lt;peinado&gt;');
    expect(result.imageUrls).toEqual(['https://images.example.com/1.jpg']);
    expect(result.product).not.toHaveProperty('images');
    expect(result.warnings.join(' ')).toContain('precios');
  });

  it('bloquea variantes sin SKU estable', () => {
    const result = mapMercadoLibreToTiendaNegocio({
      ...source, variants: [{ ...source.variants[0], sku: null }],
    });
    expect(result.readyForImport).toBe(false);
  });

  it('bloquea combinaciones de variante duplicadas', () => {
    expect(() => mapMercadoLibreToTiendaNegocio({
      ...source,
      variants: [source.variants[0], { ...source.variants[0], sku: 'OTRO' }],
    })).toThrow('Combinación de variantes duplicada');
  });

  it('maneja un producto simple', () => {
    const result = mapMercadoLibreToTiendaNegocio({
      ...source, attributes: [],
      variants: [{ ...source.variants[0], values: [] }],
    });
    expect(result.product).toMatchObject({
      published: false,
      price: '39900.00', stock: 4, sku: 'SAEL-NEGRO-M',
    });
    expect(result.product).not.toHaveProperty('variants');
  });
});
