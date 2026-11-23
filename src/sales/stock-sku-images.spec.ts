import type { MlItem } from '../mercadolibre/direct-publications/items/items.types';
import { imageForMlVariant } from './mercadolibre-curve.service';
import { imageForTnVariant } from './tiendanube-curve.service';

describe('imágenes en búsqueda de stock por SKU', () => {
  it('usa la foto propia de la variación de Mercado Libre', () => {
    const item: MlItem = {
      id: 'MLA123',
      pictures: [
        { id: 'principal', secure_url: 'https://http2.mlstatic.com/principal.jpg' },
        { id: 'variante', secure_url: 'https://http2.mlstatic.com/variante.jpg' },
      ],
      variations: [{ id: 456, picture_ids: ['variante'] }],
    };
    expect(imageForMlVariant(item, '456')).toBe(
      'https://http2.mlstatic.com/variante.jpg',
    );
    expect(imageForMlVariant(item, null)).toBe(
      'https://http2.mlstatic.com/principal.jpg',
    );
  });

  it('usa el thumbnail de ML cuando no hay galería y fuerza HTTPS de mlstatic', () => {
    expect(imageForMlVariant({
      id: 'MLA123',
      thumbnail: 'http://http2.mlstatic.com/foto.jpg',
    }, null)).toBe('https://http2.mlstatic.com/foto.jpg');
    expect(imageForMlVariant({ id: 'MLA123' }, null)).toBeNull();
  });

  it('usa la imagen asignada a la variante de Tiendanube', () => {
    const product = {
      images: [
        { id: 1, position: 1, src: 'https://static.tiendanube.com/base.jpg' },
        { id: 2, position: 2, src: 'https://static.tiendanube.com/azul.jpg' },
      ],
      variants: [{ id: 42, image_id: 2 }],
    };
    expect(imageForTnVariant(product, '42')).toBe(
      'https://static.tiendanube.com/azul.jpg',
    );
    expect(imageForTnVariant(product, '99')).toBe(
      'https://static.tiendanube.com/base.jpg',
    );
  });

  it('no envía URLs inseguras o imágenes inexistentes', () => {
    expect(imageForTnVariant({ images: [{ id: 1, src: 'javascript:alert(1)' }] }, '2')).toBeNull();
    expect(imageForTnVariant({ images: [] }, '2')).toBeNull();
  });
});
