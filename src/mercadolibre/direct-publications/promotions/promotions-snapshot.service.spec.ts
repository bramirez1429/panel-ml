import type { SupabaseService } from '../../../database/supabase.service';
import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { productGroupOf, PromotionsSnapshotService } from './promotions-snapshot.service';

describe('catalog snapshot product classification', () => {
  it('identifies remeras de niña and mujer without requesting ML promotions', () => {
    expect(productGroupOf('Remera Niña cuello redondo', null)).toBe('GIRLS_TSHIRT');
    expect(productGroupOf('Remera Mujer cuello V', null)).toBe('WOMEN_TSHIRT');
  });

  it('classifies buzos and omits non-garment categories', () => {
    expect(productGroupOf('Buzo Mujer frizado', null)).toBe('WOMEN_SWEATSHIRT');
    expect(productGroupOf('Pack de zapatos', null)).toBeNull();
  });

  it('returns every size from one family without calling Mercado Libre', async () => {
    const products = [{
      id: 'product-1', model: 'VARIANT_PRICING',
      family_id: 'family-123', parent_item_id: null,
      family_name: 'Remera Mujer', title: 'Remera Mujer',
      thumbnail: null, status: 'active', price_from: 25000, stock_total: 3,
    }];
    const children = [
      { product_id: 'product-1', item_id: 'MLA100', title: 'Remera Mujer Negra S',
        variant_label: 'Negro | S', thumbnail: null, status: 'active', price: 25000,
        available_quantity: 2, attributes: [
          { id: 'COLOR', valueName: 'Negro' }, { id: 'SIZE', valueName: 'S' },
        ] },
      { product_id: 'product-1', item_id: 'MLA200', title: 'Remera Mujer Negra M',
        variant_label: 'Negro | M', thumbnail: null, status: 'active', price: 26000,
        available_quantity: 1, attributes: [
          { id: 'COLOR', valueName: 'Negro' }, { id: 'SIZE', valueName: 'M' },
        ] },
    ];
    let table = '';
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockImplementation(async () => ({
        data: table === 'mercadolibre_products' ? products : children,
        error: null,
      })),
    };
    const database = {
      getClient: () => ({
        from: (name: string) => { table = name; return query; },
      }),
    } as unknown as SupabaseService;
    const tokens = {
      getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
    } as unknown as MercadolibreTokenService;

    const result = await new PromotionsSnapshotService(tokens, database).getSnapshot('user-id');

    expect(result.done).toBe(true);
    expect(result.publications.map(({ itemId }) => itemId)).toEqual(['MLA100', 'MLA200']);
    expect(result.publications.map(({ variantSize }) => variantSize)).toEqual(['S', 'M']);
    expect(result.publications.every(({ variantColor }) => variantColor === 'Negro')).toBe(true);
    expect(query.eq).toHaveBeenCalledWith('seller_id', 42);
    expect(query.in).toHaveBeenCalledWith('product_id', ['product-1']);
    expect(tokens.getStoredConnection).toHaveBeenCalledTimes(1);
  });
});
