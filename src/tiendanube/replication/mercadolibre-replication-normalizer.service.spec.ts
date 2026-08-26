import type { DescriptionService } from '../../mercadolibre/direct-publications/description/description.service';
import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import type { PublicationSourceService } from '../../mercadolibre/publications/sync/publication-source.service';
import type { UserProductFamilyService } from '../../mercadolibre/user-products/user-product-family.service';
import { MercadoLibreReplicationNormalizerService } from './mercadolibre-replication-normalizer.service';

describe('MercadoLibreReplicationNormalizerService', () => {
  it('lee la familia y todas sus ofertas directamente desde Mercado Libre', async () => {
    const items = new Map<string, MercadoLibrePublication>([
      ['MLA1', item('MLA1', 'MLAU1', 'Negro', 150, 2)],
      ['MLA2', item('MLA2', 'MLAU1', 'Negro', 100, 7)],
      ['MLA3', item('MLA3', 'MLAU2', 'Blanco', 120, 3)],
    ]);
    const publicationSource = {
      getItemIdsForUserProducts: jest
        .fn()
        .mockResolvedValue(['MLA1', 'MLA2', 'MLA3']),
      getItemWithAllAttributes: jest
        .fn()
        .mockImplementation((itemId: string) =>
          Promise.resolve(items.get(itemId)),
        ),
    };
    const familyService = {
      createCache: jest.fn().mockReturnValue({}),
      getFamily: jest.fn().mockResolvedValue({
        familyId: '99',
        siteId: 'MLA',
        userId: 42,
        userProductIds: ['MLAU1', 'MLAU2', 'MLAU3'],
      }),
      getUserProduct: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          attributes: [
            {
              id: 'COLOR',
              name: 'Color',
              values: [{ id: null, name: id === 'MLAU1' ? 'Negro' : 'Blanco' }],
            },
          ],
          pictures: [{ secure_url: `https://img/${id}.jpg` }],
        }),
      ),
    };
    const descriptionService = {
      getPlainTextByItemId: jest.fn().mockResolvedValue('Descripción'),
    };
    const service = new MercadoLibreReplicationNormalizerService(
      publicationSource as unknown as PublicationSourceService,
      familyService as unknown as UserProductFamilyService,
      descriptionService as unknown as DescriptionService,
    );

    const result = await service.normalize('family:99', 42, 'ml-token');

    expect(publicationSource.getItemIdsForUserProducts).toHaveBeenCalledWith(
      42,
      ['MLAU1', 'MLAU2', 'MLAU3'],
      'ml-token',
    );
    expect(publicationSource.getItemWithAllAttributes).toHaveBeenCalledTimes(3);
    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]).toMatchObject({ price: 100, stock: 7 });
  });
});

function item(
  id: string,
  userProductId: string,
  color: string,
  price: number,
  stock: number,
): MercadoLibrePublication {
  return {
    id,
    seller_id: 42,
    user_product_id: userProductId,
    title: 'Producto familiar',
    price,
    available_quantity: stock,
    attributes: [{ id: 'COLOR', name: 'Color', value_name: color }],
  };
}
