import type { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { SupabasePublicationsReadSource } from './supabase-publications-read-source';

describe('SupabasePublicationsReadSource', () => {
  it('devuelve SHARED y familia con el mismo contrato, métricas y cursor', async () => {
    const tokens = {
      getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 123 }),
    };
    const products = {
      findGroupedPage: jest.fn().mockResolvedValue({
        total: 3,
        products: [
          {
            id: 'p1',
            seller_id: 123,
            external_key: 'item:MLA1',
            model: 'SHARED',
            family_id: null,
            parent_item_id: 'MLA1',
            family_name: null,
            title: 'Remera mujer',
            thumbnail: 'shared.jpg',
            status: 'active',
            category_id: 'MLA1',
            currency_id: 'ARS',
            price_from: 100,
            price_to: 100,
            stock_total: 8,
            sold_total: 4,
            children_count: 0,
            permalink: 'shared-link',
            source_updated_at: null,
            last_synced_at: '2026-09-25T00:00:00Z',
            updated_at: '2026-09-25T00:00:00Z',
            shared_variations: [{ id: 1 }, { id: 2 }],
          },
          {
            id: 'p2',
            seller_id: 123,
            external_key: 'family:99',
            model: 'VARIANT_PRICING',
            family_id: '99',
            parent_item_id: null,
            family_name: 'Buzos',
            title: 'Buzo mujer',
            thumbnail: 'family.jpg',
            status: 'active',
            category_id: 'MLA2',
            currency_id: 'ARS',
            price_from: 200,
            price_to: 300,
            stock_total: 12,
            sold_total: 7,
            children_count: 3,
            permalink: 'family-link',
            source_updated_at: null,
            last_synced_at: '2026-09-25T00:00:00Z',
            updated_at: '2026-09-25T00:00:00Z',
            shared_variations: [],
          },
        ],
      }),
    };
    const source = new SupabasePublicationsReadSource(
      tokens as unknown as MercadolibreTokenService,
      products as unknown as MercadolibreProductsRepository,
    );

    const result = await source.getGrouped('user', 2, undefined, '  Mujer ');

    expect(products.findGroupedPage).toHaveBeenCalledWith(123, 0, 2, ['mujer']);
    expect(result).toMatchObject({
      done: false,
      rawItemsCount: 4,
      productsCount: 2,
      products: [
        {
          key: 'item:MLA1',
          model: 'SHARED',
          stock: 8,
          sold: 4,
          variantsCount: 2,
        },
        {
          key: 'family:99',
          model: 'VARIANT_PRICING',
          stock: 12,
          sold: 7,
          itemsCount: 3,
        },
      ],
    });
    expect(result.nextCursor).toMatch(/^supabase-publications:v1:/u);

    products.findGroupedPage.mockResolvedValueOnce({ total: 3, products: [] });
    await source.getGrouped('user', 2, result.nextCursor ?? undefined);
    expect(products.findGroupedPage).toHaveBeenLastCalledWith(123, 2, 2, []);
  });
});
