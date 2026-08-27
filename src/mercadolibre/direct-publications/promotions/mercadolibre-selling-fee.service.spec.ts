import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { MercadoLibreSellingFeeService } from './mercadolibre-selling-fee.service';
import type { PromotionCatalogMatch } from './promotions-catalog.types';

describe('MercadoLibreSellingFeeService', () => {
  it('consulta listing_prices con el precio efectivo y calcula estimatedNetAmount', async () => {
    const api = { get: jest.fn().mockResolvedValue([{ sale_fee_amount: 25 }]) };
    const service = new MercadoLibreSellingFeeService(
      api as unknown as MercadolibreApiService,
    );
    const result = await service.getMany([match()], 'token');

    expect(result).toEqual([{ saleFeeAmount: 25, estimatedNetAmount: 75 }]);
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining(
        '/sites/MLA/listing_prices?price=100&category_id=MLA-CAT',
      ),
      'token',
    );
    const calls = api.get.mock.calls as unknown as Array<unknown[]>;
    expect(calls[0]?.[0]).toContain('listing_type_id=gold_special');
    expect(calls[0]?.[0]).toContain('shipping_mode=me2');
    expect(calls[0]?.[0]).toContain('logistic_type=self_service');
  });

  it('devuelve null si listing_prices falla', async () => {
    const api = { get: jest.fn().mockRejectedValue(new Error('ML')) };
    const service = new MercadoLibreSellingFeeService(
      api as unknown as MercadolibreApiService,
    );

    await expect(service.getMany([match()], 'token')).resolves.toEqual([null]);
  });
});

function match(): PromotionCatalogMatch {
  return {
    candidate: {
      itemId: 'MLA1',
      familyId: null,
      title: 'Remera',
      thumbnail: null,
      productGroup: 'WOMEN_TSHIRT',
      price: 100,
      categoryId: 'MLA-CAT',
      listingTypeId: 'gold_special',
      shippingMode: 'me2',
      logisticType: 'self_service',
    },
    promotions: { active: [], candidates: [], pending: [], all: [] },
    summary: {
      status: 'NONE',
      activeTypes: [],
      candidateTypes: [],
      pendingTypes: [],
    },
  };
}
