import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { FamiliesService } from '../families/families.service';
import type { ItemsService } from '../items/items.service';

import { PublicationPromotionSourceService } from './publication-promotion-source.service';

describe('PublicationPromotionSourceService', () => {
  it('resuelve una publicación LEGACY como un único MLA', async () => {
    const service = createService({ id: 'MLA1', variations: [{}] });

    const result = await service.resolve('user', 'item:MLA1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.publication).toEqual({
      type: 'CLASSIC',
      itemId: 'MLA1',
    });
  });

  it('resuelve un MLA de FAMILY como un único MLA NEW', async () => {
    const service = createService({
      id: 'MLA2',
      family_id: 123,
      user_product_id: 'UP1',
    });

    const result = await service.resolve('user', 'item:MLA2');

    expect(result.sourceKey).toBe('item:MLA2');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.publication).toEqual({
      type: 'NEW',
      familyId: '123',
      itemId: 'MLA2',
    });
  });

  it('resuelve todos los MLA actuales de una FAMILY y deduplica', async () => {
    const service = createService({ id: 'MLA0', variations: [{}] }, [
      { id: 'MLA1', family_id: 123 },
      { id: 'MLA2', family_id: 123 },
      { id: 'MLA2', family_id: 123 },
    ]);

    const result = await service.resolve('user', 'family:123');

    expect(result.items.map(({ item }) => item.id)).toEqual(['MLA1', 'MLA2']);
    expect(
      result.items.every(({ publication }) => publication.type === 'NEW'),
    ).toBe(true);
  });

  it('no oculta MLA que no pudieron resolverse en una FAMILY', async () => {
    const service = createService(
      { id: 'MLA0', variations: [{}] },
      [{ id: 'MLA1', family_id: 123 }],
      ['MLA1', 'MLA2'],
    );

    await expect(service.resolve('user', 'family:123')).rejects.toMatchObject({
      response: { code: 'PROMOTION_PROVIDER_UNAVAILABLE' },
    });
  });
});

function createService(
  item: object,
  familyItems: object[] = [],
  itemIds = familyItems.flatMap((value) =>
    'id' in value && typeof value.id === 'string' ? [value.id] : [],
  ),
) {
  const token = { getValidAccessToken: jest.fn().mockResolvedValue('token') };
  const items = { getOne: jest.fn().mockResolvedValue(item) };
  const families = {
    getFamilyItems: jest.fn().mockResolvedValue({
      family: { family_id: 123 },
      items: familyItems,
      itemIds,
      accessToken: 'token',
    }),
  };
  return new PublicationPromotionSourceService(
    token as unknown as MercadolibreTokenService,
    items as unknown as ItemsService,
    families as unknown as FamiliesService,
  );
}
