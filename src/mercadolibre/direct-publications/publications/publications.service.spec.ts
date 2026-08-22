import type { MercadoLibreConnection } from '../../../database/supabase.service';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { FamiliesService } from '../families/families.service';
import { ItemsService } from '../items/items.service';
import { PublicationsSearchService } from './publications-search.service';
import { PublicationsService } from './publications.service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function connection(
  userId: string,
  sellerId: number,
  accessToken: string,
): MercadoLibreConnection {
  return {
    user_id: userId,
    seller_id: sellerId,
    nickname: `SELLER_${sellerId}`,
    access_token: `${accessToken}-stored`,
    refresh_token: `refresh-${sellerId}`,
    expires_at: '2030-01-01T00:00:00.000Z',
    updated_at: '2029-01-01T00:00:00.000Z',
  };
}

describe('Direct PublicationsService', () => {
  it('usa exclusivamente la conexion y el token del usuario indicado', async () => {
    const connectionA = connection(USER_A, 101, 'access-a');
    const connectionB = connection(USER_B, 202, 'access-b');
    const tokenService = {
      getStoredConnection: jest.fn((userId: string) =>
        Promise.resolve(userId === USER_A ? connectionA : connectionB),
      ),
      getValidAccessToken: jest.fn((userId: string) =>
        Promise.resolve(userId === USER_A ? 'access-a' : 'access-b'),
      ),
    };
    const searchService = {
      searchPage: jest.fn((sellerId: number) =>
        Promise.resolve({
          seller_id: sellerId,
          results: [],
          paging: { limit: 20, offset: 0, total: 0 },
        }),
      ),
    };
    const itemsService = { getMany: jest.fn().mockResolvedValue([]) };
    const service = new PublicationsService(
      tokenService as unknown as MercadolibreTokenService,
      searchService as unknown as PublicationsSearchService,
      itemsService as unknown as ItemsService,
      {} as FamiliesService,
    );

    await service.getPage(USER_A);
    await service.getPage(USER_B);

    expect(tokenService.getStoredConnection).toHaveBeenNthCalledWith(1, USER_A);
    expect(tokenService.getStoredConnection).toHaveBeenNthCalledWith(2, USER_B);
    expect(tokenService.getValidAccessToken).toHaveBeenNthCalledWith(
      1,
      USER_A,
      connectionA,
    );
    expect(tokenService.getValidAccessToken).toHaveBeenNthCalledWith(
      2,
      USER_B,
      connectionB,
    );
    expect(searchService.searchPage).toHaveBeenNthCalledWith(
      1,
      connectionA.seller_id,
      'access-a',
      20,
      0,
    );
    expect(searchService.searchPage).toHaveBeenNthCalledWith(
      2,
      connectionB.seller_id,
      'access-b',
      20,
      0,
    );
    expect(itemsService.getMany).toHaveBeenNthCalledWith(1, [], 'access-a');
    expect(itemsService.getMany).toHaveBeenNthCalledWith(2, [], 'access-b');
  });
});
