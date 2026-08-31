import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { ItemsService } from '../items/items.service';
import { DealService } from './deal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = 'MLA3679412006';
const PROMOTION_ID = 'P-MLA123';

describe('DealService removal', () => {
  it.each([
    ['CLASSIC', { id: ITEM_ID, variations: [{}] }],
    [
      'NEW',
      {
        id: ITEM_ID,
        family_id: '123456789',
        user_product_id: 'MLAU123',
      },
    ],
  ])('usa el MLA concreto para DELETE DEAL %s', async (model, item) => {
    const token = {
      getValidAccessToken: jest.fn().mockResolvedValue('token'),
    };
    const api = { delete: jest.fn().mockResolvedValue(undefined) };
    const items = { getOne: jest.fn().mockResolvedValue(item) };
    const service = new DealService(
      token as unknown as MercadolibreTokenService,
      api as unknown as MercadolibreApiService,
      items as unknown as ItemsService,
    );

    if (model === 'CLASSIC') {
      await service.deleteClassic(USER_ID, ITEM_ID, PROMOTION_ID);
    } else {
      await service.deleteNew(USER_ID, '123456789', ITEM_ID, PROMOTION_ID);
    }

    expect(api.delete).toHaveBeenCalledWith(
      `/seller-promotions/items/${ITEM_ID}` +
        '?promotion_type=DEAL' +
        `&promotion_id=${PROMOTION_ID}` +
        '&app_version=v2',
      'token',
      'promotion',
      undefined,
    );
    expect(items.getOne).toHaveBeenCalledWith(
      ITEM_ID,
      'token',
      'promotion',
      undefined,
    );
  });
});
