import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { MercadoLibreSellingFeeService } from './mercadolibre-selling-fee.service';
import type { SellingFeeRequest } from './mercadolibre-selling-fee.service';

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
    expect(calls[0]?.[0]).toContain('currency_id=ARS');
    expect(calls[0]?.[0]).toContain('shipping_mode=me2');
    expect(calls[0]?.[0]).toContain('logistic_type=self_service');
    expect(calls[0]?.[0]).toContain('billable_weight=462');
  });

  it('resta el costo de envío gratis del neto', async () => {
    const api = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path.startsWith('/sites/MLA/listing_prices')) {
          return Promise.resolve([
            { sale_fee_amount: 25 },
          ]);
        }

        if (
          path.startsWith(
            '/users/42/shipping_options/free',
          )
        ) {
          return Promise.resolve({
            coverage: {
              all_country: {
                list_cost: 10,
                currency_id: 'ARS',
              },
            },
          });
        }

        throw new Error('Ruta inesperada');
      }),
    };

    const service =
      new MercadoLibreSellingFeeService(
        api as unknown as MercadolibreApiService,
      );

    const request = match();

    const result = await service.getMany(
      [
        {
          ...request,
          candidate: {
            ...request.candidate,
            freeShipping: true,
            condition: 'new',
          },
        },
      ],
      'token',
      42,
    );

    expect(result).toEqual([
      {
        saleFeeAmount: 25,
        estimatedNetAmount: 65,
      },
    ]);

    const calls =
      api.get.mock.calls as unknown as Array<
        [string]
      >;

    expect(calls[1]?.[0]).toContain(
      '/users/42/shipping_options/free?',
    );
    expect(calls[1]?.[0]).toContain(
      'item_id=MLA1',
    );
    expect(calls[1]?.[0]).toContain(
      'item_price=100',
    );
    expect(calls[1]?.[0]).toContain(
      'free_shipping=true',
    );
    expect(calls[1]?.[0]).toContain(
      'condition=new',
    );
  });

  it('separa base de comisión y precio comprador para envío', async () => {
    const api = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path.startsWith('/sites/MLA/listing_prices')) {
          return Promise.resolve([
            { sale_fee_amount: 20 },
          ]);
        }

        if (
          path.startsWith(
            '/users/42/shipping_options/free',
          )
        ) {
          return Promise.resolve({
            coverage: {
              all_country: {
                list_cost: 5,
              },
            },
          });
        }

        throw new Error('Ruta inesperada');
      }),
    };

    const service =
      new MercadoLibreSellingFeeService(
        api as unknown as MercadolibreApiService,
      );

    const request = match();

    const result = await service.getMany(
      [
        {
          ...request,
          effectivePrice: 100,
          shippingPrice: 90,
          candidate: {
            ...request.candidate,
            freeShipping: true,
            condition: 'new',
          },
        },
      ],
      'token',
      42,
    );

    expect(result).toEqual([
      {
        saleFeeAmount: 20,
        estimatedNetAmount: 75,
      },
    ]);

    const calls =
      api.get.mock.calls as unknown as Array<
        [string]
      >;

    expect(calls[0]?.[0]).toContain(
      'listing_prices?price=100',
    );

    expect(calls[1]?.[0]).toContain(
      'item_price=90',
    );
  });

  it('devuelve null si listing_prices falla', async () => {
    const api = { get: jest.fn().mockRejectedValue(new Error('ML')) };
    const service = new MercadoLibreSellingFeeService(
      api as unknown as MercadolibreApiService,
    );

    await expect(service.getMany([match()], 'token')).resolves.toEqual([null]);
  });

  it('omite currency y billable_weight cuando el item no los informa', async () => {
    const api = { get: jest.fn().mockResolvedValue([{ sale_fee_amount: 25 }]) };
    const service = new MercadoLibreSellingFeeService(
      api as unknown as MercadolibreApiService,
    );
    const request = match();

    await service.getMany(
      [
        {
          ...request,
          candidate: {
            ...request.candidate,
            currencyId: null,
            billableWeight: null,
          },
        },
      ],
      'token',
    );

    const calls = api.get.mock.calls as unknown as Array<unknown[]>;
    expect(calls[0]?.[0]).not.toContain('currency_id=');
    expect(calls[0]?.[0]).not.toContain('billable_weight=');
  });
});

function match(): SellingFeeRequest {
  return {
    candidate: {
      itemId: 'MLA1',
      familyId: null,
      title: 'Remera',
      thumbnail: null,
      productGroup: 'WOMEN_TSHIRT',
      price: 100,
      categoryId: 'MLA-CAT',
      currencyId: 'ARS',
      listingTypeId: 'gold_special',
      shippingMode: 'me2',
      logisticType: 'self_service',
      billableWeight: 462,
    },
    effectivePrice: 100,
  };
}
