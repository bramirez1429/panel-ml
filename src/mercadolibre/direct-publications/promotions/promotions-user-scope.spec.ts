import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import type { PublicationDetailService } from '../publications/publication-detail.service';
import { DealController } from './deal.controller';
import { DealService } from './deal.service';
import { PriceDiscountController } from './price-discount.controller';
import { PriceDiscountService } from './price-discount.service';
import { PromotionManagerController } from './promotion-manager.controller';
import { PromotionManagerService } from './promotion-manager.service';
import { SellerCampaignController } from './seller-campaign.controller';
import { SellerCampaignService } from './seller-campaign.service';
import { SmartPromotionController } from './smart-promotion.controller';
import { SmartPromotionService } from './smart-promotion.service';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = 'MLA123';
const ACCESS_TOKEN = 'user-private-access-token';
const CLASSIC_ITEM: MlItem = {
  id: ITEM_ID,
  attributes: [],
  pictures: [],
  variations: [],
};

describe('promociones por usuario', () => {
  it('protege todos los controllers con el access token de la app', () => {
    const controllers = [
      DealController,
      PriceDiscountController,
      PromotionManagerController,
      SellerCampaignController,
      SmartPromotionController,
    ];

    for (const controller of controllers) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(
        AccessTokenGuard,
      );
    }
  });

  it('propaga userId al resolver tokens para cada tipo de promoción', async () => {
    const getValidAccessToken = jest.fn().mockResolvedValue(ACCESS_TOKEN);
    const tokenService = {
      getValidAccessToken,
    } as unknown as MercadolibreTokenService;
    const apiService = {
      post: jest.fn().mockResolvedValue({ ok: true }),
    } as unknown as MercadolibreApiService;
    const itemsService = {
      getOne: jest.fn().mockResolvedValue(CLASSIC_ITEM),
    } as unknown as ItemsService;

    const deal = new DealService(tokenService, apiService, itemsService);
    const priceDiscount = new PriceDiscountService(
      tokenService,
      apiService,
      itemsService,
    );
    const sellerCampaign = new SellerCampaignService(
      tokenService,
      apiService,
      itemsService,
    );
    const smart = new SmartPromotionService(
      tokenService,
      apiService,
      itemsService,
    );

    await Promise.all([
      deal.createClassic(USER_ID, ITEM_ID, {
        promotionId: 'deal-1',
        dealPrice: 100,
      }),
      priceDiscount.createClassicPriceDiscount(USER_ID, ITEM_ID, {
        dealPrice: 100,
        startDate: '2026-08-22T00:00:00.000Z',
        finishDate: '2026-08-23T00:00:00.000Z',
      }),
      sellerCampaign.createClassic(USER_ID, ITEM_ID, {
        promotionId: 'campaign-1',
        dealPrice: 100,
      }),
      smart.createClassic(USER_ID, ITEM_ID, {
        promotionId: 'smart-1',
        offerId: 'offer-1',
      }),
    ]);

    expect(getValidAccessToken.mock.calls).toEqual([
      [USER_ID],
      [USER_ID],
      [USER_ID],
      [USER_ID],
    ]);
  });

  it('mantiene userId durante todo el flujo del promotion manager', async () => {
    const getDetail = jest
      .fn()
      .mockResolvedValueOnce({ promotions: { active: [] } })
      .mockResolvedValueOnce({
        promotions: {
          candidates: [{ id: 'deal-1', type: 'DEAL' }],
        },
      })
      .mockResolvedValueOnce({
        promotions: {
          active: [{ id: 'deal-1', type: 'DEAL' }],
        },
      });
    const createClassic = jest.fn().mockResolvedValue({ ok: true });
    const service = new PromotionManagerService(
      { getDetail } as unknown as PublicationDetailService,
      {} as PriceDiscountService,
      { createClassic } as unknown as DealService,
      {} as SellerCampaignService,
      {} as SmartPromotionService,
    );

    const result = await service.switchClassic(USER_ID, ITEM_ID, {
      type: 'DEAL',
      promotionId: 'deal-1',
      dealPrice: 100,
    });

    expect(getDetail.mock.calls).toEqual([
      [USER_ID, ITEM_ID],
      [USER_ID, ITEM_ID],
      [USER_ID, ITEM_ID],
    ]);
    expect(createClassic).toHaveBeenCalledWith(USER_ID, ITEM_ID, {
      promotionId: 'deal-1',
      dealPrice: 100,
      topDealPrice: undefined,
    });
    expect(result.verified).toBe(true);
  });
});
