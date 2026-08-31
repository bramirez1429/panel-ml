import type { MlItem } from '../items/items.types';
import type { PublicationCatalogScannerService } from './publication-catalog-scanner.service';
import { PublicationTitleItemsSearchService } from './publication-title-items-search.service';

describe('PublicationTitleItemsSearchService', () => {
  it('encuentra coincidencias parciales sin distinguir mayúsculas', async () => {
    const scanner = scannerWith([
      { id: 'MLA1', title: 'REMERA Mujer Cuello V' },
      { id: 'MLA2', title: 'Pantalón de mujer' },
    ]);
    const service = new PublicationTitleItemsSearchService(scanner);

    const result = await service.search(42, 'token', 'remera mujer', 20);

    expect(result.items.map(({ id }) => id)).toEqual(['MLA1']);
    expect(result).toMatchObject({ done: true, nextCursor: null });
  });

  it('mantiene paginación por cursor sin devolver todo el catálogo', async () => {
    const catalog = [
      { id: 'MLA1', title: 'Remera uno' },
      { id: 'MLA2', title: 'Remera dos' },
      { id: 'MLA3', title: 'Remera tres' },
    ];
    const scanner = scannerWith(catalog, false);
    const service = new PublicationTitleItemsSearchService(scanner);

    const result = await service.search(
      42,
      'token',
      'remera',
      1,
      'title-search:1',
    );

    expect(result.items.map(({ id }) => id)).toEqual(['MLA2']);
    expect(result.nextCursor).toBe('title-search:2');
  });
});

function scannerWith(
  items: MlItem[],
  reachedEnd = true,
): PublicationCatalogScannerService {
  return {
    scan: jest.fn(
      (
        _sellerId: number,
        _accessToken: string,
        consume: (page: readonly MlItem[]) => boolean,
      ) => {
        consume(items);
        return Promise.resolve({ reachedEnd });
      },
    ),
  } as unknown as PublicationCatalogScannerService;
}
