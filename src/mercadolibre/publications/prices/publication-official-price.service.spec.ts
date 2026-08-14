import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationOfficialPriceService } from './publication-official-price.service';

describe('PublicationOfficialPriceService', () => {
  const getOptional = jest.fn();
  const service = new PublicationOfficialPriceService({
    getOptional,
  } as unknown as MercadolibreApiService);

  beforeEach(() => jest.resetAllMocks());

  it('hidrata el standard de marketplace y omite precios por cantidad', async () => {
    getOptional.mockImplementation((path: string) =>
      path.endsWith('/prices')
        ? {
            id: 'MLA100',
            prices: [
              {
                type: 'standard',
                amount: 700,
                currency_id: 'ARS',
                conditions: {
                  context_restrictions: ['channel_marketplace'],
                  min_purchase_unit: 2,
                },
              },
              {
                type: 'standard',
                amount: 1_000,
                currency_id: 'ARS',
                conditions: {
                  context_restrictions: ['channel_marketplace'],
                },
              },
            ],
          }
        : {
            amount: 800,
            regular_amount: 1_000,
            currency_id: 'ARS',
            metadata: { promotion_type: 'PRICE_DISCOUNT' },
          },
    );

    await expect(
      service.hydrate({ id: 'MLA100', price: 900 }, 'token'),
    ).resolves.toMatchObject({ id: 'MLA100', price: 800, currency_id: 'ARS' });
  });
});
