import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { ItemsService } from '../items/items.service';

import type { PromotionManagerService } from './promotion-manager.service';
import { PromotionSelectionService } from './promotion-selection.service';
import type { PromotionsService } from './promotions.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('PromotionSelectionService', () => {
  it('valida candidate real y reutiliza PromotionManagerService', async () => {
    const manager = {
      switchClassic: jest.fn().mockResolvedValue({ verified: true }),
    };
    const service = createService(manager);

    await expect(
      service.apply(USER_ID, 'MLA1', {
        type: 'DEAL',
        promotionId: 'deal-1',
        dealPrice: 70,
      }),
    ).resolves.toMatchObject({ success: true, itemId: 'MLA1' });
    expect(manager.switchClassic).toHaveBeenCalledWith(USER_ID, 'MLA1', {
      type: 'DEAL',
      promotionId: 'deal-1',
      dealPrice: 70,
    });
  });

  it('rechaza candidate inexistente sin intentar aplicar', async () => {
    const manager = { switchClassic: jest.fn() };
    const service = createService(manager, []);

    await expect(
      service.apply(USER_ID, 'MLA1', {
        type: 'DEAL',
        promotionId: 'missing',
        dealPrice: 70,
      }),
    ).rejects.toMatchObject({ response: { code: 'PROMOTION_NOT_FOUND' } });
    expect(manager.switchClassic).not.toHaveBeenCalled();
  });
});

function createService(
  manager: object,
  candidates = [{ id: 'deal-1', type: 'DEAL', price: 70 }],
) {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
    getValidAccessToken: jest.fn().mockResolvedValue('token'),
  };
  const items = {
    getOne: jest.fn().mockResolvedValue({
      id: 'MLA1',
      family_id: null,
      variations: [],
      status: 'active',
    }),
  };
  const promotions = {
    getPromotionsStrict: jest.fn().mockResolvedValue({
      active: [],
      candidates,
      pending: [],
      all: candidates,
    }),
  };
  return new PromotionSelectionService(
    token as unknown as MercadolibreTokenService,
    items as unknown as ItemsService,
    promotions as unknown as PromotionsService,
    manager as unknown as PromotionManagerService,
  );
}
