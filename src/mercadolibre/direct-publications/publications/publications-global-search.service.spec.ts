import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationSourceService } from '../../publications/sync/publication-source.service';
import type { FamiliesService } from '../families/families.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import { PublicationsGlobalSearchService } from './publications-global-search.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SELLER_ID = 42;
const ACCESS_TOKEN = 'ml-token';

describe('PublicationsGlobalSearchService', () => {
  it('encuentra un título que llegó en una página posterior del scan', async () => {
    const responses = [
      { results: ['MLA1'], scroll_id: 'global-scroll' },
      { results: ['MLA101'], scroll_id: 'global-scroll' },
      { results: null },
    ];
    const api = { get: jest.fn().mockImplementation(() => responses.shift()) };
    const source = new PublicationSourceService(
      api as unknown as MercadolibreApiService,
    );
    const items = {
      getMany: jest
        .fn()
        .mockResolvedValue([
          item('MLA1', 'Producto inicial'),
          item('MLA101', 'Pack X4 Unid Remeras Nenas Algodón Peinado'),
        ]),
    };
    const service = new PublicationsGlobalSearchService(
      source,
      items as unknown as ItemsService,
      { getSummary: jest.fn() } as unknown as FamiliesService,
    );

    const result = await service.search(
      USER_ID,
      SELLER_ID,
      ACCESS_TOKEN,
      'algodon nena',
      20,
    );

    expect(api.get).toHaveBeenCalledTimes(3);
    const apiCalls = api.get.mock.calls as unknown as Array<unknown[]>;
    expect(String(apiCalls[1]?.[0])).toContain(
      'search_type=scan&limit=100&scroll_id=global-scroll',
    );
    expect(items.getMany).toHaveBeenCalledWith(
      ['MLA1', 'MLA101'],
      ACCESS_TOKEN,
    );
    expect(result.products).toEqual([
      expect.objectContaining({ key: 'item:MLA101' }),
    ]);
  });

  it('no duplica una familia cuando varios MLA coinciden', async () => {
    const family = {
      key: 'family:900',
      model: 'VARIANT_PRICING' as const,
      familyId: '900',
      familyName: 'Buzos Brooklyn',
      variantsCount: 2,
      itemsCount: 2,
      variants: [],
    };
    const { service, families } = createService([
      familyItem('MLA1', 'Buzo Mujer Brooklyn Negro', '900'),
      familyItem('MLA2', 'Buzo Mujer Brooklyn Blanco', '900'),
    ]);
    families.getSummary.mockResolvedValue(family);

    const result = await service.search(
      USER_ID,
      SELLER_ID,
      ACCESS_TOKEN,
      'brook buzo',
      20,
    );

    expect(result.products).toEqual([family]);
    expect(result.rawItemsCount).toBe(2);
    expect(families.getSummary).toHaveBeenCalledTimes(1);
    expect(families.getSummary).toHaveBeenCalledWith(USER_ID, '900');
  });

  it('pagina después de filtrar y agrupar, respetando limit 20', async () => {
    const catalog = Array.from({ length: 21 }, (_, index) =>
      item(`MLA${index + 1}`, `Remera ${index + 1}`),
    );
    const { service } = createService(catalog);

    const first = await service.search(
      USER_ID,
      SELLER_ID,
      ACCESS_TOKEN,
      'reme',
      20,
    );
    const second = await service.search(
      USER_ID,
      SELLER_ID,
      ACCESS_TOKEN,
      'reme',
      20,
      first.nextCursor ?? undefined,
    );

    expect(first.products).toHaveLength(20);
    expect(first).toMatchObject({ done: false, nextCursor: 'title-search:20' });
    expect(second.products).toHaveLength(1);
    expect(second).toMatchObject({ done: true, nextCursor: null });
  });

  it('sin coincidencias devuelve products vacío', async () => {
    const { service, families } = createService([
      item('MLA1', 'Pantalón de jean'),
    ]);

    const result = await service.search(
      USER_ID,
      SELLER_ID,
      ACCESS_TOKEN,
      'remeras',
      20,
    );

    expect(result).toMatchObject({
      done: true,
      nextCursor: null,
      rawItemsCount: 0,
      productsCount: 0,
      products: [],
    });
    expect(families.getSummary).not.toHaveBeenCalled();
  });
});

function createService(catalog: MlItem[]) {
  const source = {
    getAllItemIds: jest.fn().mockResolvedValue(catalog.map(({ id }) => id)),
  };
  const items = { getMany: jest.fn().mockResolvedValue(catalog) };
  const families = { getSummary: jest.fn() };
  return {
    source,
    items,
    families,
    service: new PublicationsGlobalSearchService(
      source as unknown as PublicationSourceService,
      items as unknown as ItemsService,
      families as unknown as FamiliesService,
    ),
  };
}

function item(id: string, title: string): MlItem {
  return { id, title, variations: [] };
}

function familyItem(id: string, title: string, familyId: string): MlItem {
  return {
    id,
    title,
    family_id: familyId,
    family_name: 'Buzos Brooklyn',
    user_product_id: `MLAU${id.replace('MLA', '')}`,
  };
}
