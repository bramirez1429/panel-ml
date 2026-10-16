import type { PublicationSourceService } from '../../publications/sync/publication-source.service';
import type { ItemsService } from '../items/items.service';
import { PublicationCatalogScannerService } from './publication-catalog-scanner.service';

describe('PublicationCatalogScannerService', () => {
  it('escanea active y paused por separado para no perder publicaciones ocultas', async () => {
    const source = { fetchNextScanPage: jest.fn().mockResolvedValue({ itemIds: [], scrollId: null }) };
    const scanner = new PublicationCatalogScannerService(source as unknown as PublicationSourceService, {} as ItemsService);
    await scanner.scanActiveAndPaused(42, 'token', () => false);
    expect(source.fetchNextScanPage.mock.calls).toEqual([
      [42, 'token', undefined, 'active'],
      [42, 'token', undefined, 'paused'],
    ]);
  });
});
