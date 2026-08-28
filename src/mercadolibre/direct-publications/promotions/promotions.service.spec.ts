import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { PromotionsService } from './promotions.service';

describe('PromotionsService', () => {
  it('consulta las campaÃ±as directamente para el seller autenticado', async () => {
    const api = { get: jest.fn().mockResolvedValue([]) };
    const service = new PromotionsService(
      api as unknown as MercadolibreApiService,
    );

    await service.getSellerCampaigns('user-id', 42, 'token');

    expect(api.get).toHaveBeenCalledWith(
      '/seller-promotions/users/42?app_version=v2',
      'token',
      'promotion',
    );
  });
});
