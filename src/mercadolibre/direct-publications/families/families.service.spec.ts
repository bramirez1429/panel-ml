import { NotFoundException } from '@nestjs/common';

import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { ItemsService } from '../items/items.service';
import type { PublicationsSearchService } from '../publications/publications-search.service';
import { FamiliesService } from './families.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('FamiliesService', () => {
  it('resuelve todos los MLA de la familia con un token y un multiget', async () => {
    const context = createService();
    context.api.get.mockResolvedValue({
      family_id: '123456789',
      site_id: 'MLA',
      user_id: 42,
      user_products_ids: ['MLAU1', 'MLAU2'],
    });
    context.search.searchByUserProductIds.mockResolvedValue([
      'MLA1',
      'MLA2',
      'MLA3',
    ]);
    context.items.getMany.mockResolvedValue([
      { id: 'MLA1' },
      { id: 'MLA2' },
      { id: 'MLA3' },
    ]);

    const result = await context.service.getFamilyItems(USER_ID, '123456789');

    expect(result.itemIds).toEqual(['MLA1', 'MLA2', 'MLA3']);
    expect(result.items.map(({ id }) => id)).toEqual(['MLA1', 'MLA2', 'MLA3']);
    expect(context.token.getStoredConnection).toHaveBeenCalledTimes(1);
    expect(context.token.getValidAccessToken).toHaveBeenCalledTimes(1);
    expect(context.api.get).toHaveBeenCalledWith(
      '/sites/MLA/user-products-families/123456789',
      'token',
    );
    expect(context.search.searchByUserProductIds).toHaveBeenCalledWith(
      42,
      ['MLAU1', 'MLAU2'],
      'token',
    );
    expect(context.items.getMany).toHaveBeenCalledTimes(1);
    expect(context.items.getMany).toHaveBeenCalledWith(
      ['MLA1', 'MLA2', 'MLA3'],
      'token',
    );
  });

  it('propaga family inexistente sin buscar MLA ni items', async () => {
    const context = createService();
    context.api.get.mockRejectedValue(new NotFoundException());

    await expect(
      context.service.getFamilyItems(USER_ID, '999999'),
    ).rejects.toThrow(NotFoundException);
    expect(context.search.searchByUserProductIds).not.toHaveBeenCalled();
    expect(context.items.getMany).not.toHaveBeenCalled();
  });
});

function createService() {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({
      user_id: USER_ID,
      seller_id: 42,
    }),
    getValidAccessToken: jest.fn().mockResolvedValue('token'),
  };
  const api = { get: jest.fn() };
  const search = { searchByUserProductIds: jest.fn() };
  const items = { getMany: jest.fn() };
  return {
    token,
    api,
    search,
    items,
    service: new FamiliesService(
      token as unknown as MercadolibreTokenService,
      api as unknown as MercadolibreApiService,
      search as unknown as PublicationsSearchService,
      items as unknown as ItemsService,
    ),
  };
}
