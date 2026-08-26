import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { PublicationSourceService } from '../../publications/sync/publication-source.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import type { MercadoLibreCategoriesService } from './mercadolibre-categories.service';
import { PromotionsFacetsService } from './promotions-facets.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token';

describe('PromotionsFacetsService', () => {
  it('agrega categorías y atributos comerciales reales, sin técnicos', async () => {
    const catalog: MlItem[] = [
      {
        id: 'MLA1',
        title: 'Remera',
        category_id: 'MLA-REMERAS',
        price: 100,
        status: 'active',
        attributes: [
          { id: 'GENDER', name: 'Género', value_name: 'Mujer' },
          { id: 'GTIN', name: 'GTIN', value_name: '779000' },
        ],
        variations: [
          {
            attribute_combinations: [
              { id: 'COLOR', name: 'Color', value_name: 'Rojo' },
            ],
          },
        ],
      },
      {
        id: 'MLA2',
        title: 'Buzo',
        category_id: 'MLA-BUZOS',
        price: 200,
        status: 'active',
        attributes: [
          { id: 'GENDER', name: 'Género', value_name: 'Mujer' },
          { id: 'COLOR', name: 'Color', value_name: 'Negro' },
        ],
        variations: [],
      },
    ];
    const byId = new Map(catalog.map((item) => [item.id, item]));
    const source = {
      fetchNextScanPage: jest
        .fn()
        .mockResolvedValueOnce({ itemIds: ['MLA1', 'MLA2'], scrollId: 'next' })
        .mockResolvedValueOnce({ itemIds: [], scrollId: null }),
    };
    const items = {
      getMany: jest.fn((ids: string[]) =>
        Promise.resolve(
          ids.flatMap((id) => (byId.get(id) ? [byId.get(id)] : [])),
        ),
      ),
    };
    const categories = {
      getMany: jest.fn().mockResolvedValue(
        new Map([
          [
            'MLA-REMERAS',
            { id: 'MLA-REMERAS', name: 'Remeras', path: ['Ropa', 'Remeras'] },
          ],
          [
            'MLA-BUZOS',
            { id: 'MLA-BUZOS', name: 'Buzos', path: ['Ropa', 'Buzos'] },
          ],
        ]),
      ),
    };
    const token = {
      getStoredConnection: jest.fn().mockResolvedValue({
        user_id: USER_ID,
        seller_id: 42,
      }),
      getValidAccessToken: jest.fn().mockResolvedValue(TOKEN),
    };
    const service = new PromotionsFacetsService(
      token as unknown as MercadolibreTokenService,
      source as unknown as PublicationSourceService,
      items as unknown as ItemsService,
      categories as unknown as MercadoLibreCategoriesService,
    );

    const result = await service.getFacets(USER_ID);

    expect(result.categories).toEqual([
      expect.objectContaining({ id: 'MLA-REMERAS', count: 1 }),
      expect.objectContaining({ id: 'MLA-BUZOS', count: 1 }),
    ]);
    expect(result.attributes).toEqual([
      {
        id: 'GENDER',
        name: 'Género',
        values: [{ value: 'Mujer', count: 2 }],
      },
      {
        id: 'COLOR',
        name: 'Color',
        values: [
          { value: 'Rojo', count: 1 },
          { value: 'Negro', count: 1 },
        ],
      },
    ]);
  });
});
