import type { PublicationSourceService } from '../../publications/sync/publication-source.service';
import type { FamiliesService } from '../families/families.service';
import type { FamilySummary } from '../families/family.types';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import { PublicationCatalogScannerService } from './publication-catalog-scanner.service';
import { PublicationsGlobalSearchService } from './publications-global-search.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SELLER_ID = 42;
const ACCESS_TOKEN = 'ml-token';

describe('PublicationsGlobalSearchService', () => {
  it('encuentra producto en la primera página y deja de escanear', async () => {
    const { service, source, items } = createService(
      [['MLA1'], ['MLA2']],
      [item('MLA1', 'Remera Algodón'), item('MLA2', 'Otra remera')],
    );

    const result = await search(service, 'algodon', 1);

    expect(result.products).toEqual([
      expect.objectContaining({ key: 'item:MLA1' }),
    ]);
    expect(source.fetchNextScanPage).toHaveBeenCalledTimes(1);
    expect(items.getMany).toHaveBeenCalledTimes(1);
  });

  it('encuentra producto en una página posterior', async () => {
    const { service, source, items } = createService(
      [['MLA1'], ['MLA101'], ['MLA201']],
      [
        item('MLA1', 'Producto inicial'),
        item('MLA101', 'Pack X4 Remeras Nenas Algodón'),
        item('MLA201', 'No debe cargarse'),
      ],
    );

    const result = await search(service, 'algodon nena', 1);

    expect(result.products).toEqual([
      expect.objectContaining({ key: 'item:MLA101' }),
    ]);
    expect(source.fetchNextScanPage).toHaveBeenCalledTimes(2);
    expect(items.getMany.mock.calls).toEqual([
      [['MLA1'], ACCESS_TOKEN],
      [['MLA101'], ACCESS_TOKEN],
    ]);
  });

  it('deja de escanear al completar limit y no resuelve familias fuera del slice', async () => {
    const { service, source, families } = createService(
      [['MLA1', 'MLA2', 'MLA3'], ['MLA4']],
      [
        item('MLA1', 'Remera uno'),
        item('MLA2', 'Remera dos'),
        familyItem('MLA3', 'Remera familiar', '900'),
        item('MLA4', 'Remera cuatro'),
      ],
    );

    const result = await search(service, 'reme', 2);

    expect(result.products).toHaveLength(2);
    expect(source.fetchNextScanPage).toHaveBeenCalledTimes(1);
    expect(families.getSummary).not.toHaveBeenCalled();
  });

  it('no duplica familias aunque sus MLA aparezcan en páginas distintas', async () => {
    const family = familySummary('900');
    const { service, source, families } = createService(
      [['MLA1'], ['MLA2', 'MLA3'], ['MLA4']],
      [
        familyItem('MLA1', 'Buzo Brooklyn Negro', '900'),
        familyItem('MLA2', 'Buzo Brooklyn Blanco', '900'),
        item('MLA3', 'Buzo Brooklyn Legacy'),
        item('MLA4', 'No debe cargarse'),
      ],
    );
    families.getSummary.mockResolvedValue(family);

    const result = await search(service, 'brook buzo', 2);

    expect(result.products).toEqual([
      family,
      expect.objectContaining({ key: 'item:MLA3' }),
    ]);
    expect(result.rawItemsCount).toBe(3);
    expect(source.fetchNextScanPage).toHaveBeenCalledTimes(2);
    expect(families.getSummary).toHaveBeenCalledTimes(1);
  });

  it('resuelve la segunda página con title-search:20', async () => {
    const firstPage = Array.from(
      { length: 20 },
      (_, index) => `MLA${index + 1}`,
    );
    const secondPage = Array.from(
      { length: 20 },
      (_, index) => `MLA${index + 21}`,
    );
    const catalog = [...firstPage, ...secondPage].map((id) =>
      item(id, `Remera ${id}`),
    );
    const { service, source } = createService(
      [firstPage, secondPage, []],
      catalog,
    );

    const first = await search(service, 'reme', 20);
    const second = await search(service, 'reme', 20, 'title-search:20');

    expect(first.products).toHaveLength(20);
    expect(first.nextCursor).toBe('title-search:20');
    expect(second.products).toHaveLength(20);
    expect(second.products[0]).toMatchObject({ key: 'item:MLA21' });
    expect(second.nextCursor).toBe('title-search:40');
    expect(source.fetchNextScanPage).toHaveBeenCalledTimes(3);
    expect(source.fetchNextScanPage.mock.calls[1]?.[2]).toBeUndefined();
  });

  it('sin resultados recorre el scan hasta el final', async () => {
    const { service, source, items, families } = createService(
      [['MLA1'], ['MLA2'], []],
      [item('MLA1', 'Pantalón'), item('MLA2', 'Campera')],
    );

    const result = await search(service, 'remeras', 20);

    expect(result).toMatchObject({
      done: true,
      nextCursor: null,
      rawItemsCount: 0,
      productsCount: 0,
      products: [],
    });
    expect(source.fetchNextScanPage).toHaveBeenCalledTimes(3);
    expect(items.getMany).toHaveBeenCalledTimes(2);
    expect(families.getSummary).not.toHaveBeenCalled();
  });
});

function createService(pages: string[][], catalog: MlItem[]) {
  const byId = new Map(catalog.map((value) => [value.id, value]));
  const source = {
    fetchNextScanPage: jest.fn(
      (_sellerId: number, _token: string, scrollId?: string) => {
        const index = scrollId ? Number(scrollId.replace('scan:', '')) : 0;
        const itemIds = pages[index] ?? [];
        return Promise.resolve({
          itemIds,
          scrollId: itemIds.length > 0 ? `scan:${index + 1}` : null,
        });
      },
    ),
  };
  const items = {
    getMany: jest.fn((ids: string[]) =>
      Promise.resolve(ids.flatMap((id) => byId.get(id) ?? [])),
    ),
  };
  const families = { getSummary: jest.fn() };
  const scanner = new PublicationCatalogScannerService(
    source as unknown as PublicationSourceService,
    items as unknown as ItemsService,
  );
  return {
    source,
    items,
    families,
    service: new PublicationsGlobalSearchService(
      scanner,
      families as unknown as FamiliesService,
    ),
  };
}

function search(
  service: PublicationsGlobalSearchService,
  query: string,
  limit: number,
  cursor?: string,
) {
  return service.search(USER_ID, SELLER_ID, ACCESS_TOKEN, query, limit, cursor);
}

function item(id: string, title: string): MlItem {
  return { id, title, variations: [] };
}

function familyItem(id: string, title: string, familyId: string): MlItem {
  return {
    id,
    title,
    family_id: familyId,
    family_name: 'Familia',
    user_product_id: `MLAU${id.replace('MLA', '')}`,
  };
}

function familySummary(familyId: string): FamilySummary {
  return {
    key: `family:${familyId}`,
    model: 'VARIANT_PRICING',
    familyId,
    familyName: 'Familia',
    variantsCount: 2,
    itemsCount: 2,
    variants: [],
  };
}
