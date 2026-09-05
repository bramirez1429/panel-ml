import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import type {
  MercadoLibreSellingFeeService,
  SellingFeeRequest,
} from './mercadolibre-selling-fee.service';
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

  it('expone started, candidate y pending con el contrato financiero completo', async () => {
    const active = {
      id: 'active-1',
      ref_id: 'OFFER-1',
      type: 'DEAL',
      name: 'Activa',
      price: 80,
      original_price: 100,
      min_discounted_price: 30,
      max_discounted_price: 90,
      suggested_discounted_price: 85,
      discount_meli_boost_amount: 5,
      start_date: '2026-09-01T00:00:00Z',
      finish_date: '2026-09-10T23:59:59Z',
    };
    const candidate = {
      id: 'candidate-1',
      offer_id: 'CANDIDATE-1',
      type: 'DEAL',
      name: 'Disponible',
      price: 0,
      original_price: 100,
      min_discounted_price: 30,
      max_discounted_price: 90,
      suggested_discounted_price: 85,
      discount_meli_boost_amount: 5,
      start_date: '2026-09-11T00:00:00Z',
      finish_date: '2026-09-20T23:59:59Z',
    };
    const pending = {
      id: 'pending-1',
      type: 'SELLER_CAMPAIGN',
      name: 'Programada',
      price: 90,
      original_price: 100,
      meli_percentage: 2,
      seller_percentage: 8,
      discount_meli_boost_amount: 0,
      start_date: '2026-09-21T00:00:00Z',
      finish_date: '2026-09-30T23:59:59Z',
    };
    const groupedPromotions = {
      active: [active],
      candidates: [candidate],
      pending: [pending],
      all: [active, candidate, pending],
    } satisfies MlPromotions;
    const promotions = {
      getPromotions: jest.fn().mockResolvedValue(groupedPromotions),
    };
    const fees = {
      getMany: jest.fn().mockResolvedValue([
        { saleFeeAmount: 10, estimatedNetAmount: 70 },
        { saleFeeAmount: 10, estimatedNetAmount: 75 },
        { saleFeeAmount: 9, estimatedNetAmount: 81 },
      ]),
    };
    const service = createService(promotions, fees);

    const result = await service.getOptions(USER_ID, ITEM_ID);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'active-1',
        offerId: 'OFFER-1',
        type: 'DEAL',
        name: 'Activa',
        status: 'started',
        originalPrice: 100,
        promotionPrice: 80,
        minPromotionPrice: 30,
        maxPromotionPrice: 90,
        suggestedPromotionPrice: 85,
        requiresPriceSelection: false,
        sellerDiscountAmount: 15,
        mercadoLibreBaseContributionAmount: 0,
        mercadoLibreBoostAmount: 5,
        mercadoLibreContributionAmount: 5,
        estimatedNetAmount: 70,
        suggestedEstimatedNetAmount: null,
        startDate: '2026-09-01T00:00:00Z',
        finishDate: '2026-09-10T23:59:59Z',
        canApply: false,
        canRemove: true,
        saleEstimate: { saleFeeAmount: 10, estimatedNetAmount: 70 },
      }),
      expect.objectContaining({
        id: 'candidate-1',
        offerId: 'CANDIDATE-1',
        status: 'candidate',
        promotionPrice: null,
        minPromotionPrice: 30,
        maxPromotionPrice: 90,
        suggestedPromotionPrice: 85,
        requiresPriceSelection: true,
        sellerDiscountAmount: null,
        mercadoLibreBaseContributionAmount: 0,
        mercadoLibreBoostAmount: 5,
        mercadoLibreContributionAmount: 5,
        estimatedNetAmount: null,
        suggestedEstimatedNetAmount: 75,
        canApply: true,
        canRemove: false,
        saleEstimate: null,
      }),
      expect.objectContaining({
        id: 'pending-1',
        status: 'pending',
        promotionPrice: 90,
        requiresPriceSelection: false,
        sellerDiscountAmount: 8,
        mercadoLibreBaseContributionAmount: 2,
        mercadoLibreBoostAmount: 0,
        mercadoLibreContributionAmount: 2,
        estimatedNetAmount: 81,
        suggestedEstimatedNetAmount: null,
        canApply: false,
        canRemove: true,
        saleEstimate: { saleFeeAmount: 9, estimatedNetAmount: 81 },
      }),
    ]);
    const feeCalls = fees.getMany.mock.calls as unknown as Array<
      [SellingFeeRequest[], string]
    >;
    expect(feeCalls).toHaveLength(1);
    expect(
      feeCalls[0]?.[0].map(({ effectivePrice }) => effectivePrice),
    ).toEqual([85, 90, 92]);

    expect(
      feeCalls[0]?.[0].map(({ shippingPrice }) => shippingPrice),
    ).toEqual([80, 85, 90]);
  });

  it('simula el neto candidate solamente con suggestedPromotionPrice', async () => {
    const candidate = {
      id: 'candidate-1',
      type: 'DEAL',
      status: 'candidate',
      price: 0,
      original_price: 70000,
      max_discounted_price: 65000,
      suggested_discounted_price: 61418,
    };
    const promotions = {
      getPromotions: jest.fn().mockResolvedValue({
        active: [],
        candidates: [candidate],
        pending: [],
        all: [candidate],
      } satisfies MlPromotions),
    };
    const fees = {
      getMany: jest
        .fn()
        .mockResolvedValue([
          { saleFeeAmount: 14000, estimatedNetAmount: 47418 },
        ]),
    };
    const service = createService(promotions, fees);

    const result = await service.getOptions(USER_ID, ITEM_ID);

    expect(result[0]).toMatchObject({
      promotionPrice: null,
      requiresPriceSelection: true,
      sellerDiscountAmount: null,
      estimatedNetAmount: null,
      suggestedEstimatedNetAmount: 47418,
    });
    const feeCalls = fees.getMany.mock.calls as unknown as Array<
      [SellingFeeRequest[], string]
    >;
    expect(feeCalls[0]?.[0]).toEqual([
      expect.objectContaining({ effectivePrice: 61418 }),
    ]);
  });

  it('enriquece una propuesta con la campaña y el detalle exacto del MLA', async () => {
    const itemCandidate = {
      id: 'P-CYBER',
      type: 'SMART',
      status: 'candidate',
      name: 'Potencia tus ventas',
      price: 0,
      original_price: 100,
      suggested_discounted_price: 85,
    };

    const promotions = {
      getPromotions:
        jest.fn().mockResolvedValue({
          active: [],
          candidates: [
            itemCandidate,
          ],
          pending: [],
          all: [
            itemCandidate,
          ],
        } satisfies MlPromotions),

      getSellerCampaigns:
        jest.fn().mockResolvedValue([
          {
            id: 'P-CYBER',
            type: 'SMART',
            name: 'CYBER FEST',
            start_date:
              '2026-09-06T00:00:00Z',
            finish_date:
              '2026-09-30T23:59:59Z',
          },
        ]),

      getCampaignItem:
        jest.fn().mockResolvedValue({
          id: ITEM_ID,
          status: 'candidate',
          price: 82,
          original_price: 100,

          meli_percentage: 5,
          seller_percentage: 12,

          discount_meli_amount: 5,

          boosted_offer: true,
          discount_meli_boosted_percentage: 3,
          discount_meli_boost_amount: 3,
          total_price_for_boosted_offer: 80,
        }),
    };

    const fees = {
      getMany:
        jest.fn().mockResolvedValue([
          {
            saleFeeAmount: 18,
            estimatedNetAmount: 70,
          },
        ]),
    };

    const service =
      createService(
        promotions,
        fees,
      );

    const result =
      await service.getOptions(
        USER_ID,
        ITEM_ID,
      );

    expect(
      promotions.getCampaignItem,
    ).toHaveBeenCalledWith(
      USER_ID,
      'P-CYBER',
      'SMART',
      ITEM_ID,
      'token',
    );

    expect(result[0]).toMatchObject({
      id: 'P-CYBER',
      type: 'SMART',
      name: 'CYBER FEST',

      startDate:
        '2026-09-06T00:00:00Z',

      finishDate:
        '2026-09-30T23:59:59Z',

      /*
       * total_price_for_boosted_offer
       * tiene prioridad.
       */
      promotionPrice: 80,

      sellerDiscountAmount: 12,

      sellerPercentage: 12,
      mercadoLibrePercentage: 5,
      mercadoLibreBoostedPercentage: 3,

      boostedOffer: true,
      totalPriceForBoostedOffer: 80,

      mercadoLibreBaseContributionAmount: 5,
      mercadoLibreBoostAmount: 3,
      mercadoLibreContributionAmount: 8,

      estimatedNetAmount: 70,
    });

    const feeCalls =
      fees.getMany.mock.calls as unknown as Array<
        [SellingFeeRequest[], string]
      >;

    expect(
      feeCalls[0]?.[0],
    ).toEqual([
      expect.objectContaining({
        /*
         * buyer = 80
         * ML contribution = 8
         */
        effectivePrice: 88,
        shippingPrice: 80,
      }),
    ]);
  });

  it('no consulta fees ni simula neto cuando el candidate no tiene suggested', async () => {
    const candidate = {
      id: 'candidate-1',
      type: 'DEAL',
      status: 'candidate',
      price: 0,
      original_price: 100,
      max_discounted_price: 90,
    };
    const promotions = {
      getPromotions: jest.fn().mockResolvedValue({
        active: [],
        candidates: [candidate],
        pending: [],
        all: [candidate],
      } satisfies MlPromotions),
    };
    const fees = { getMany: jest.fn() };
    const service = createService(promotions, fees);

    const result = await service.getOptions(USER_ID, ITEM_ID);

    expect(result[0]).toMatchObject({
      promotionPrice: null,
      estimatedNetAmount: null,
      suggestedEstimatedNetAmount: null,
    });
    expect(fees.getMany).not.toHaveBeenCalled();
  });
});

function createService(promotions: object, fees: object) {
  const promotionApi = {
    getSellerCampaigns:
      jest.fn().mockResolvedValue([]),

    getCampaignItem:
      jest.fn().mockResolvedValue(null),

    ...promotions,
  };

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
    promotionApi as unknown as PromotionsService,
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
