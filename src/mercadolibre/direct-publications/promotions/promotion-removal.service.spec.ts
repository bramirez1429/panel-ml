import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { ItemsService } from '../items/items.service';

import type { DealService } from './deal.service';
import type { PriceDiscountService } from './price-discount.service';
import { PromotionRemovalService } from './promotion-removal.service';
import type { PromotionsService } from './promotions.service';
import type { SellerCampaignService } from './seller-campaign.service';
import type { SmartPromotionService } from './smart-promotion.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('PromotionRemovalService', () => {
  it.each([
    ['PRICE_DISCOUNT', 'deleteClassicPriceDiscount'],
    ['DEAL', 'deleteClassic'],
    ['SELLER_CAMPAIGN', 'deleteClassic'],
    ['SMART', 'deleteClassic'],
  ])(
    'elimina la oferta activa de tipo %s y verifica que desapareció',
    async (type, method) => {
      const current = {
        active: [
          { id: 'p-1', type, ref_id: type === 'SMART' ? 'offer-1' : null },
        ],
        candidates: [],
        pending: [],
        all: [],
      };
      const empty = { active: [], candidates: [], pending: [], all: [] };
      const dependencies = createDependencies(current, empty);
      const service = new PromotionRemovalService(
        dependencies.token as unknown as MercadolibreTokenService,
        dependencies.items as unknown as ItemsService,
        dependencies.promotions as unknown as PromotionsService,
        dependencies.api as unknown as MercadolibreApiService,
        dependencies.priceDiscount as unknown as PriceDiscountService,
        dependencies.deal as unknown as DealService,
        dependencies.sellerCampaign as unknown as SellerCampaignService,
        dependencies.smart as unknown as SmartPromotionService,
      );

      await expect(service.removeAll(USER_ID, 'MLA1')).resolves.toMatchObject({
        success: true,
        itemId: 'MLA1',
        activePromotion: null,
      });
      expect(
        (dependencies[typeService(type)] as Record<string, jest.Mock>)[method],
      ).toHaveBeenCalled();
      expect(dependencies.promotions.getPromotionsStrict).toHaveBeenCalledTimes(
        2,
      );
    },
  );

  it('es idempotente cuando ya no hay promoción activa', async () => {
    const dependencies = createDependencies(
      { active: [], candidates: [], pending: [], all: [] },
      { active: [], candidates: [], pending: [], all: [] },
    );
    const service = new PromotionRemovalService(
      dependencies.token as unknown as MercadolibreTokenService,
      dependencies.items as unknown as ItemsService,
      dependencies.promotions as unknown as PromotionsService,
      dependencies.api as unknown as MercadolibreApiService,
      dependencies.priceDiscount as unknown as PriceDiscountService,
      dependencies.deal as unknown as DealService,
      dependencies.sellerCampaign as unknown as SellerCampaignService,
      dependencies.smart as unknown as SmartPromotionService,
    );

    await expect(service.removeAll(USER_ID, 'MLA1')).resolves.toMatchObject({
      success: true,
    });
    expect(dependencies.api.delete).not.toHaveBeenCalled();
  });
});

function createDependencies(current: object, after: object) {
  const token = { getValidAccessToken: jest.fn().mockResolvedValue('token') };
  const items = {
    getOne: jest.fn().mockResolvedValue({ id: 'MLA1', variations: [] }),
  };
  const promotions = {
    getPromotionsStrict: jest
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(after),
  };
  const api = { delete: jest.fn().mockResolvedValue(undefined) };
  const priceDiscount = { deleteClassicPriceDiscount: jest.fn() };
  const deal = { deleteClassic: jest.fn() };
  const sellerCampaign = { deleteClassic: jest.fn() };
  const smart = { deleteClassic: jest.fn() };
  return {
    token,
    items,
    promotions,
    api,
    priceDiscount,
    deal,
    sellerCampaign,
    smart,
  };
}

function typeService(
  type: string,
): 'priceDiscount' | 'deal' | 'sellerCampaign' | 'smart' {
  if (type === 'PRICE_DISCOUNT') return 'priceDiscount';
  if (type === 'DEAL') return 'deal';
  if (type === 'SELLER_CAMPAIGN') return 'sellerCampaign';
  return 'smart';
}
