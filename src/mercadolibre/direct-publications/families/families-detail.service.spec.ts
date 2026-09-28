import type { FamiliesService } from './families.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PromotionsService } from '../promotions/promotions.service';
import { FamiliesDetailService } from './families-detail.service';

describe('FamiliesDetailService commercial data', () => {
  it('reutiliza pricing, promociones, vendidos y cuotas por MLA', async () => {
    const families = {
      getFamilyItems: jest.fn().mockResolvedValue({
        family: {
          family_id: 456,
          user_id: 42,
          site_id: 'MLA',
          user_products_ids: ['MLAU1'],
        },
        items: [
          {
            id: 'MLA1',
            user_product_id: 'MLAU1',
            title: 'Remera',
            status: 'active',
            available_quantity: 8,
            sold_quantity: 12,
            currency_id: 'ARS',
            price: 45_000,
            seller_custom_field: 'SKU-1',
            tags: ['6x_campaign'],
            pictures: [],
            attributes: [],
          },
        ],
        itemIds: ['MLA1'],
        accessToken: 'token',
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
    const service = new FamiliesDetailService(
      families as unknown as FamiliesService,
      pricing as unknown as PricingService,
      promotions as unknown as PromotionsService,
    );

    const result = await service.getDetail('user-id', '456');

    expect(result.variants[0]).toMatchObject({
      itemId: 'MLA1',
      stock: { sold: 12 },
      installmentLabel: '6 cuotas',
      friendly: {
        pricing: { current: 45_000, discountPercent: 20 },
        promotion: { hasActivePromotion: true },
      },
    });
  });
});
