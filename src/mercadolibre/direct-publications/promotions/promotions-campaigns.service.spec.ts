import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import { PromotionsCampaignsService } from './promotions-campaigns.service';
import type { MercadoLibreSellingFeeService } from './mercadolibre-selling-fee.service';
import type { PromotionsService } from './promotions.service';
import type {
  MlPromotion,
  MlPromotionCampaignItemsResponse,
} from './promotions.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token';

describe('PromotionsCampaignsService', () => {
  it('usa las campañas globales del seller autenticado', async () => {
    const { service, promotions } = createService([campaign('C-1', 'started')]);

    await service.getCampaigns(USER_ID);

    expect(promotions.getSellerCampaigns).toHaveBeenCalledWith(
      USER_ID,
      42,
      TOKEN,
    );
  });

  it('incluye campañas started y pending, y excluye finished', async () => {
    const { service } = createService([
      campaign('C-STARTED', 'started'),
      campaign('C-PENDING', 'pending'),
      campaign('C-FINISHED', 'finished'),
    ]);

    const result = await service.getCampaigns(USER_ID);

    expect(result.campaigns.map(({ id }) => id)).toEqual([
      'C-STARTED',
      'C-PENDING',
    ]);
  });

  it('normaliza los datos de campaña informados por Mercado Libre', async () => {
    const { service } = createService([
      {
        id: ' C-1 ',
        name: ' Cyber Fest ',
        type: ' DEAL ',
        status: 'started',
        start_date: ' 2026-08-20T00:00:00Z ',
        finish_date: ' 2026-08-27T23:59:59Z ',
        deadline_date: ' 2026-08-19T23:59:59Z ',
      },
    ]);

    await expect(service.getCampaigns(USER_ID)).resolves.toEqual({
      campaigns: [
        {
          id: 'C-1',
          name: 'Cyber Fest',
          type: 'DEAL',
          status: 'started',
          startDate: '2026-08-20T00:00:00Z',
          finishDate: '2026-08-27T23:59:59Z',
          deadlineDate: '2026-08-19T23:59:59Z',
        },
      ],
    });
  });

  it('enriquece título, imagen, precios, aportes reales, boost y neto estimado', async () => {
    const { service, items, fees } = createService(
      [],
      {
        results: [
          {
            id: 'MLA123',
            status: 'candidate',
            original_price: 20000,
            promotion_price: 16000,
            discount_meli_amount: 1500,
            discount_meli_boost_amount: 500,
          },
        ],
        paging: { total: 51, offset: 0, limit: 50 },
      },
      [item('MLA123')],
      [{ saleFeeAmount: 2000, estimatedNetAmount: 14000 }],
    );

    await expect(
      service.getCampaignItems(USER_ID, 'P-MLA123', {
        promotionType: 'MARKETPLACE_CAMPAIGN',
        limit: 50,
        offset: 0,
      }),
    ).resolves.toEqual({
      items: [
        {
          itemId: 'MLA123',
          title: 'Remera',
          thumbnail: 'https://img/MLA123.jpg',
          status: 'candidate',
          currentPrice: 20000,
          promotionPrice: 16000,
          sellerDiscountAmount: 2000,
          mercadoLibreBaseContributionAmount: 1500,
          mercadoLibreBoostAmount: 500,
          mercadoLibreContributionAmount: 2000,
          estimatedNetAmount: 14000,
        },
      ],
      paging: { total: 51, offset: 0, limit: 50 },
    });
    expect(items.getMany).toHaveBeenCalledWith(['MLA123'], TOKEN);
    expect(fees.getMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          itemId: 'MLA123',
          effectivePrice: 16000,
        }),
      ],
      TOKEN,
    );
  });

  it('mantiene null cuando ML no informa aporte y tolera detalles parciales', async () => {
    const { service, fees } = createService(
      [],
      {
        results: [
          { id: 'MLA1', status: 'candidate', price: 10000 },
          { id: 'MLA2', status: 'candidate', price: 12000 },
        ],
        paging: { total: 2, offset: 50, limit: 50 },
      },
      [item('MLA1')],
    );

    await expect(
      service.getCampaignItems(USER_ID, 'P-MLA123', {
        promotionType: 'MARKETPLACE_CAMPAIGN',
      }),
    ).resolves.toEqual({
      items: [
        {
          itemId: 'MLA1',
          title: 'Remera',
          thumbnail: 'https://img/MLA1.jpg',
          status: 'candidate',
          currentPrice: 10000,
          promotionPrice: 10000,
          sellerDiscountAmount: null,
          mercadoLibreBaseContributionAmount: null,
          mercadoLibreBoostAmount: null,
          mercadoLibreContributionAmount: null,
          estimatedNetAmount: null,
        },
        {
          itemId: 'MLA2',
          title: null,
          thumbnail: null,
          status: 'candidate',
          currentPrice: null,
          promotionPrice: 12000,
          sellerDiscountAmount: null,
          mercadoLibreBaseContributionAmount: null,
          mercadoLibreBoostAmount: null,
          mercadoLibreContributionAmount: null,
          estimatedNetAmount: null,
        },
      ],
      paging: { total: 2, offset: 50, limit: 50 },
    });
    expect(fees.getMany).toHaveBeenCalledWith(
      [expect.objectContaining({ itemId: 'MLA1' })],
      TOKEN,
    );
  });
});

function createService(
  campaigns: MlPromotion[],
  campaignItems: MlPromotionCampaignItemsResponse = { results: [] },
  itemDetails: MlItem[] = [],
  estimates: Array<{
    saleFeeAmount: number;
    estimatedNetAmount: number;
  } | null> = [],
) {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
    getValidAccessToken: jest.fn().mockResolvedValue(TOKEN),
  };
  const promotions = {
    getSellerCampaigns: jest.fn().mockResolvedValue(campaigns),
    getCampaignItems: jest.fn().mockResolvedValue(campaignItems),
  };
  const items = { getMany: jest.fn().mockResolvedValue(itemDetails) };
  const fees = { getMany: jest.fn().mockResolvedValue(estimates) };
  return {
    promotions,
    items,
    fees,
    service: new PromotionsCampaignsService(
      token as unknown as MercadolibreTokenService,
      promotions as unknown as PromotionsService,
      items as unknown as ItemsService,
      fees as unknown as MercadoLibreSellingFeeService,
    ),
  };
}

function campaign(id: string, status: string): MlPromotion {
  return { id, name: id, type: 'DEAL', status };
}

function item(id: string): MlItem {
  return {
    id,
    title: 'Remera',
    thumbnail: `https://img/${id}.jpg`,
    category_id: 'MLA-CAT',
    price: 10000,
    listing_type_id: 'gold_special',
    shipping: { mode: 'me2', logistic_type: 'self_service' },
  };
}
