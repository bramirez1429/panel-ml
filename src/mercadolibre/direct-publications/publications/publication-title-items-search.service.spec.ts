import type { PublicationSourceService } from '../../publications/sync/publication-source.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import { PublicationCatalogScannerService } from './publication-catalog-scanner.service';
import { PublicationTitleItemsSearchService } from './publication-title-items-search.service';

describe('PublicationTitleItemsSearchService', () => {
  it('encuentra coincidencias parciales sin distinguir mayúsculas', async () => {
    const context = createService(
      [['MLA1', 'MLA2']],
      [
        item('MLA1', 'REMERA Mujer Cuello V'),
        item('MLA2', 'Pantalón de mujer'),
      ],
    );

    const result = await context.service.search(
      42,
      'token',
      'remera mujer',
      20,
    );

    expect(result.items.map(({ id }) => id)).toEqual(['MLA1']);
    expect(result).toMatchObject({ done: true, nextCursor: null });
  });

  it('continúa desde scroll_id sin recomenzar el scan', async () => {
    const context = createService(
      [['MLA1'], ['MLA2']],
      [item('MLA1', 'Remera uno'), item('MLA2', 'Remera dos')],
    );

    const first = await context.service.search(42, 'token', 'remera', 1);
    const second = await context.service.search(
      42,
      'token',
      'remera',
      1,
      first.nextCursor ?? undefined,
    );

    expect(first.items.map(({ id }) => id)).toEqual(['MLA1']);
    expect(second.items.map(({ id }) => id)).toEqual(['MLA2']);
    expect(context.source.fetchNextScanPage.mock.calls).toEqual([
      [42, 'token', undefined],
      [42, 'token', 'scan:1'],
    ]);
  });

  it('conserva matches sobrantes del lote sin repetir el scan', async () => {
    const context = createService(
      [['MLA1', 'MLA2']],
      [item('MLA1', 'Remera uno'), item('MLA2', 'Remera dos')],
    );

    const first = await context.service.search(42, 'token', 'remera', 1);
    const second = await context.service.search(
      42,
      'token',
      'remera',
      1,
      first.nextCursor ?? undefined,
    );

    expect(first.items.map(({ id }) => id)).toEqual(['MLA1']);
    expect(second.items.map(({ id }) => id)).toEqual(['MLA2']);
    expect(context.source.fetchNextScanPage).toHaveBeenCalledTimes(1);
    expect(context.items.getMany).toHaveBeenCalledTimes(2);
  });
});

function createService(pages: string[][], catalog: MlItem[]) {
  const byId = new Map(catalog.map((value) => [value.id, value]));
  const source = {
    fetchNextScanPage: jest.fn(
      (_sellerId: number, _accessToken: string, scrollId?: string) => {
        const index = scrollId ? Number(scrollId.replace('scan:', '')) : 0;
        const itemIds = pages[index] ?? [];
        return Promise.resolve({
          itemIds,
          scrollId: index + 1 < pages.length ? `scan:${index + 1}` : null,
        });
      },
    ),
  };
  const items = {
    getMany: jest.fn((ids: string[]) =>
      Promise.resolve(ids.flatMap((id) => byId.get(id) ?? [])),
    ),
  };
  const scanner = new PublicationCatalogScannerService(
    source as unknown as PublicationSourceService,
    items as unknown as ItemsService,
  );
  return {
    source,
    items,
    service: new PublicationTitleItemsSearchService(
      scanner,
      items as unknown as ItemsService,
    ),
  };
}

function item(id: string, title: string): MlItem {
  return { id, seller_id: 42, title };
}
