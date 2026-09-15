import { TiendanubeConnectionRepository } from '../tiendanube/connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../tiendanube/shared/tiendanube-api.service';
import { RecentSalesRepository } from './recent-sales.repository';
import { TiendanubeSaleIngestionService } from './tiendanube-sale-ingestion.service';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

describe('TiendanubeSaleIngestionService', () => {
  it('resuelve el usuario por store y registra cada linea pagada', async () => {
    const connections = {
      findCredentialsByStoreId: jest.fn().mockResolvedValue({
        userId: 'user-a',
        storeId: '99',
        accessToken: 'private-tn-token',
        scope: 'write_products',
      }),
    };
    const order = {
      id: 700,
      payment_status: 'paid',
      paid_at: '2026-09-14T11:00:00-03:00',
      products: [
        {
          id: 701,
          product_id: 10,
          variant_id: 20,
          quantity: 1,
          name: 'Remera',
          sku: 'RM-NEG-M',
          variant_values: ['M', 'Negro'],
        },
      ],
    };
    const api = {
      get: jest.fn().mockImplementation((...request: [string, string]) =>
        Promise.resolve(
          request[1] === '/orders/700'
            ? order
            : {
                id: 10,
                attributes: [{ es: 'Talle' }, { es: 'Color' }],
                variants: [
                  {
                    id: 20,
                    sku: 'RM-NEG-M',
                    values: ['M', 'Negro'],
                    stock: 2,
                  },
                ],
              },
        ),
      ),
    };
    const sales = { saveMany: jest.fn().mockResolvedValue(undefined) };
    const links = { findByUserId: jest.fn().mockResolvedValue([]) };
    const service = new TiendanubeSaleIngestionService(
      connections as unknown as TiendanubeConnectionRepository,
      api as unknown as TiendanubeApiService,
      sales as unknown as RecentSalesRepository,
      links as unknown as VariantChannelLinksRepository,
    );

    await service.process('700', '99');

    expect(api.get).toHaveBeenCalledWith(
      '99',
      '/orders/700',
      'private-tn-token',
    );
    expect(sales.saveMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'user-a',
        channel: 'TIENDANUBE',
        externalOrderId: '700',
        externalOrderItemId: '701',
        tnProductId: '10',
        tnVariantId: '20',
        color: 'Negro',
        size: 'M',
      }),
    ]);
  });

  it('no procesa stores sin una conexion perteneciente al panel', async () => {
    const api = { get: jest.fn() };
    const sales = { saveMany: jest.fn() };
    const service = new TiendanubeSaleIngestionService(
      {
        findCredentialsByStoreId: jest.fn().mockResolvedValue(null),
      } as unknown as TiendanubeConnectionRepository,
      api as unknown as TiendanubeApiService,
      sales as unknown as RecentSalesRepository,
      {} as VariantChannelLinksRepository,
    );

    await service.process('700', '99');

    expect(api.get).not.toHaveBeenCalled();
    expect(sales.saveMany).not.toHaveBeenCalled();
  });
});
