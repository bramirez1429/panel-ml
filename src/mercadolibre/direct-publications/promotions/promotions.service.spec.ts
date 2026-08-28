import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { PromotionsService } from './promotions.service';

describe('PromotionsService', () => {
  it('parsea la respuesta real de campañas del seller', async () => {
    const response = {
      results: [
        {
          id: 'P-MLA123',
          name: 'Cyber Fest',
          type: 'MARKETPLACE_CAMPAIGN',
          status: 'started',
        },
      ],
    };
    const api = { get: jest.fn().mockResolvedValue(response) };
    const service = new PromotionsService(
      api as unknown as MercadolibreApiService,
    );

    await expect(
      service.getSellerCampaigns('user-id', 42, 'token'),
    ).resolves.toEqual(response.results);

    expect(api.get).toHaveBeenCalledWith(
      '/seller-promotions/users/42?app_version=v2',
      'token',
      'promotion',
    );
  });

  it('consulta directamente una página de items de campaña', async () => {
    const api = { get: jest.fn().mockResolvedValue({ results: [] }) };
    const service = new PromotionsService(
      api as unknown as MercadolibreApiService,
    );

    await service.getCampaignItems(
      'user-id',
      'P-MLA123',
      'MARKETPLACE_CAMPAIGN',
      'token',
      { limit: 50, offset: 0 },
    );

    expect(api.get).toHaveBeenCalledWith(
      '/seller-promotions/promotions/P-MLA123/items?promotion_type=MARKETPLACE_CAMPAIGN&app_version=v2&limit=50&offset=0',
      'token',
      'promotion',
    );
  });
});
