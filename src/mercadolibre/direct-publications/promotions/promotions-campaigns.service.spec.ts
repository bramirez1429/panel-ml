import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';

import { PromotionsCampaignsService } from './promotions-campaigns.service';
import type { PromotionsService } from './promotions.service';
import type { MlPromotion } from './promotions.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token';

describe('PromotionsCampaignsService', () => {
  it('usa las campaÃ±as globales del seller autenticado', async () => {
    const { service, promotions } = createService([campaign('C-1', 'started')]);

    await service.getCampaigns(USER_ID);

    expect(promotions.getSellerCampaigns).toHaveBeenCalledWith(
      USER_ID,
      42,
      TOKEN,
    );
  });

  it('incluye campaÃ±as started y pending, y excluye finished', async () => {
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

  it('normaliza los datos de campaÃ±a informados por Mercado Libre', async () => {
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

  it('no tiene dependencias de scan ni de consultas MLA', () => {
    const { service } = createService([]);

    expect(service).not.toHaveProperty('publicationSource');
    expect(service).not.toHaveProperty('itemsService');
  });

  it('normaliza una página real de MLA de la campaña seleccionada', async () => {
    const { service, promotions } = createService([], {
      results: [
        {
          id: 'MLA123',
          status: 'candidate',
          price: 20000,
          promotion_price: 16000,
        },
      ],
      paging: { total: 51, offset: 0, limit: 50 },
    });

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
          status: 'candidate',
          price: 20000,
          promotionPrice: 16000,
        },
      ],
      paging: { total: 51, offset: 0, limit: 50 },
    });
    expect(promotions.getCampaignItems).toHaveBeenCalledWith(
      USER_ID,
      'P-MLA123',
      'MARKETPLACE_CAMPAIGN',
      TOKEN,
      { limit: 50, offset: 0 },
    );
  });
});

function createService(
  campaigns: MlPromotion[],
  campaignItems = { results: [] },
) {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
    getValidAccessToken: jest.fn().mockResolvedValue(TOKEN),
  };
  const promotions = {
    getSellerCampaigns: jest.fn().mockResolvedValue(campaigns),
    getCampaignItems: jest.fn().mockResolvedValue(campaignItems),
  };
  return {
    promotions,
    service: new PromotionsCampaignsService(
      token as unknown as MercadolibreTokenService,
      promotions as unknown as PromotionsService,
    ),
  };
}

function campaign(id: string, status: string): MlPromotion {
  return { id, name: id, type: 'DEAL', status };
}
