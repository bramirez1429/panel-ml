import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { PublicationManagementContext } from '../mutations/publication-management-target.service';
import { PublicationManagementTargetService } from '../mutations/publication-management-target.service';
import { PublicationPricesService } from './publication-prices.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const CONTEXT = {
  target: {
    productId: PRODUCT_ID,
    model: 'SHARED' as const,
    itemId: 'MLA100',
    userProductId: null,
  },
  sellerId: 123,
  accessToken: 'token',
} as unknown as PublicationManagementContext;

describe('PublicationPricesService', () => {
  const resolveAll = jest.fn();
  const getOwnedItem = jest.fn();
  const get = jest.fn();
  let service: PublicationPricesService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolveAll.mockResolvedValue([CONTEXT]);
    getOwnedItem.mockResolvedValue({ id: 'MLA100', seller_id: 123 });
    get.mockImplementation((path: string) => {
      if (path === '/items/MLA100/prices') {
        return Promise.resolve({
          id: 'MLA100',
          prices: [
            {
              id: 'STD',
              type: 'standard',
              amount: 1_000,
              currency_id: 'ARS',
              conditions: {
                context_restrictions: ['channel_marketplace'],
              },
            },
            {
              id: 'PROMO',
              type: 'promotion',
              amount: 800,
              regular_amount: 1_000,
              currency_id: 'ARS',
              conditions: {
                context_restrictions: ['channel_marketplace'],
                start_time: '2026-08-01T00:00:00Z',
                end_time: '2026-08-14T23:59:59Z',
              },
              metadata: {
                promotion_id: 'PROMO-1',
                promotion_type: 'PRICE_DISCOUNT',
              },
            },
          ],
        });
      }
      return Promise.resolve({
        amount: 800,
        regular_amount: 1_000,
        currency_id: 'ARS',
        metadata: {
          promotion_id: 'PROMO-1',
          promotion_type: 'PRICE_DISCOUNT',
        },
      });
    });
    service = new PublicationPricesService(
      {
        resolveAll,
        getOwnedItem,
      } as unknown as PublicationManagementTargetService,
      { get } as unknown as MercadolibreApiService,
    );
  });

  it('lee los endpoints oficiales y compone el precio comercial', async () => {
    const result = await service.get(PRODUCT_ID, undefined);

    expect(getOwnedItem).toHaveBeenCalledWith(CONTEXT);
    expect(get).toHaveBeenCalledWith('/items/MLA100/prices', 'token');
    expect(get).toHaveBeenCalledWith(
      '/items/MLA100/sale_price?context=channel_marketplace',
      'token',
    );
    expect(result.summary).toMatchObject({
      standardPrice: 1_000,
      salePrice: 800,
      regularPrice: 1_000,
      promotionPrice: 800,
      promotionPercentage: 20,
      promotionId: 'PROMO-1',
      promotionType: 'PRICE_DISCOUNT',
      promotionStartDate: '2026-08-01T00:00:00Z',
      promotionEndDate: '2026-08-14T23:59:59Z',
    });
    expect(result.targets[0].officialPrices).toHaveLength(2);
  });

  it('no infiere promocion solo por una diferencia de precio de kit', async () => {
    get.mockImplementation((path: string) =>
      path.endsWith('/prices')
        ? Promise.resolve({
            id: 'MLA100',
            prices: [
              {
                id: 'STD',
                type: 'standard',
                amount: 1_000,
                currency_id: 'ARS',
                conditions: {
                  context_restrictions: ['channel_marketplace'],
                },
              },
            ],
          })
        : Promise.resolve({
            amount: 800,
            regular_amount: 1_000,
            currency_id: 'ARS',
            metadata: {},
          }),
    );

    const result = await service.get(PRODUCT_ID, undefined);

    expect(result.summary.promotionPrice).toBeNull();
    expect(result.summary.promotionPercentage).toBeNull();
  });
});
