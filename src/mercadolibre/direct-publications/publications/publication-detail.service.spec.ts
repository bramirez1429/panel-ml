import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { ItemsService } from '../items/items.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PromotionsService } from '../promotions/promotions.service';
import { PublicationDetailService } from './publication-detail.service';

describe('PublicationDetailService commercial data', () => {
  it('expone vendidos, promoción efectiva y cuotas del MLA', async () => {
    const token = { getValidAccessToken: jest.fn().mockResolvedValue('token') };
    const items = {
      getOne: jest.fn().mockResolvedValue({
        id: 'MLA1',
        title: 'Remera',
        status: 'active',
        available_quantity: 8,
        sold_quantity: 12,
        price: 45_000,
        currency_id: 'ARS',
        tags: ['6x_campaign'],
        pictures: [],
        variations: [],
        attributes: [],
      }),
    };
    const pricing = {
      getPrice: jest.fn().mockResolvedValue({
        current: 45_000,
        regular: 56_250,
        standard: 56_250,
        currency: 'ARS',
        all: [{ type: 'promotion', amount: 45_000 }],
        metadata: {},
      }),
    };
    const promotions = {
      getPromotions: jest.fn().mockResolvedValue({
        active: [{ id: 'PROMO', status: 'started' }],
        candidates: [],
        pending: [],
        all: [{ id: 'PROMO', status: 'started' }],
      }),
    };
    const service = new PublicationDetailService(
      token as unknown as MercadolibreTokenService,
      items as unknown as ItemsService,
      pricing as unknown as PricingService,
      promotions as unknown as PromotionsService,
    );

    const result = await service.getDetail('user-id', 'MLA1');

    expect(result).toMatchObject({
      stock: { sold: 12 },
      installmentLabel: '6 cuotas',
      friendly: {
        pricing: { current: 45_000, discountPercent: 20 },
        promotion: { hasActivePromotion: true },
      },
    });
  });
});
