import type { PublicationSourceService } from '../../mercadolibre/publications/sync/publication-source.service';
import type { UserProductFamilyService } from '../../mercadolibre/user-products/user-product-family.service';
import { TiendanubeMigrationDiscoveryService } from './tiendanube-migration-discovery.service';

describe('TiendanubeMigrationDiscoveryService', () => {
  it('agrupa MLA de la misma familia en el mismo sourceKey sin inventar identificadores', async () => {
    const publicationSource = {
      fetchNextScanPage: jest
        .fn()
        .mockResolvedValue({ itemIds: ['MLA1', 'MLA2'], scrollId: null }),
      getPublicationDetails: jest.fn().mockResolvedValue({
        publications: [
          { id: 'MLA1', title: 'Uno', user_product_id: 'MLAU1' },
          { id: 'MLA2', title: 'Dos', user_product_id: 'MLAU2' },
        ],
        errors: [],
      }),
    };
    const familyService = {
      createCache: jest.fn().mockReturnValue({}),
      resolveFamily: jest
        .fn()
        .mockResolvedValueOnce({
          familyId: '10',
          userId: 42,
          userProductIds: ['MLAU1', 'MLAU2'],
        })
        .mockResolvedValueOnce({
          familyId: '10',
          userId: 42,
          userProductIds: ['MLAU1', 'MLAU2'],
        }),
    };
    const service = new TiendanubeMigrationDiscoveryService(
      publicationSource as unknown as PublicationSourceService,
      familyService as unknown as UserProductFamilyService,
    );
    const result = await service.discoverPage({
      sellerId: 42,
      accessToken: 'token',
      scrollId: null,
    });
    expect(result.items.map((item) => item.sourceKey)).toEqual(['family:10']);
    expect(result.items.flatMap((item) => item.mlaIds)).toEqual([
      'MLA1',
      'MLA2',
    ]);
  });
});
