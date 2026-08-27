import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import type { MercadoLibreSellingFeeService } from './mercadolibre-selling-fee.service';
import { PromotionOptionsService } from './promotion-options.service';
import type { PromotionsService } from './promotions.service';
import type { MlPromotions } from './promotions.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = 'MLA1';

describe('PromotionOptionsService', () => {
  it('consulta candidates bajo demanda, normaliza y marca tipos no soportados', async () => {
    const candidates = [
      {
        id: 'deal-1',
        type: 'DEAL',
        name: 'Deal',
        price: 70,
        original_price: 100,
      },
      {
        id: 'light-1',
        type: 'LIGHTNING',
        name: 'Lightning',
        price: 60,
        original_price: 100,
      },
    ];
    const promotions = {
      getPromotions: jest.fn().mockResolvedValue({
        active: [],
        candidates,
        pending: [],
        all: candidates,
      } satisfies MlPromotions),
    };
    const fees = {
      getMany: jest
        .fn()
        .mockResolvedValue([
          { saleFeeAmount: 10, estimatedNetAmount: 60 },
          null,
        ]),
    };
    const service = createService(promotions, fees);

    const result = await service.getOptions(USER_ID, ITEM_ID);

    expect(promotions.getPromotions).toHaveBeenCalledWith(
      USER_ID,
      ITEM_ID,
      'token',
    );
    expect(fees.getMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'deal-1',
        offerId: null,
        discountPercent: 30,
        canApply: true,
        saleEstimate: { saleFeeAmount: 10, estimatedNetAmount: 60 },
      }),
      expect.objectContaining({
        id: 'light-1',
        canApply: false,
        saleEstimate: null,
      }),
    ]);
  });
});

function createService(promotions: object, fees: object) {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
    getValidAccessToken: jest.fn().mockResolvedValue('token'),
  };
  const items = {
    getOne: jest.fn().mockResolvedValue(item()),
  };
  return new PromotionOptionsService(
    token as unknown as MercadolibreTokenService,
    items as unknown as ItemsService,
    promotions as unknown as PromotionsService,
    fees as unknown as MercadoLibreSellingFeeService,
  );
}

function item(): MlItem {
  return {
    id: ITEM_ID,
    title: 'Remera',
    domain_id: 'MLA-WOMEN_TSHIRTS',
    category_id: 'MLA-CAT',
    price: 100,
    status: 'active',
  };
}
