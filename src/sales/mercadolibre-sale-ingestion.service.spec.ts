import { MercadolibreTokenService } from '../mercadolibre/auth/mercadolibre-token.service';
import { PublicationSourceService } from '../mercadolibre/publications/sync/publication-source.service';
import { MercadolibreApiService } from '../mercadolibre/shared/mercadolibre-api.service';
import { MercadolibreSaleIngestionService } from './mercadolibre-sale-ingestion.service';
import { RecentSalesRepository } from './recent-sales.repository';
import type { SaveRecentSale } from './sales.types';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

describe('MercadolibreSaleIngestionService', () => {
  it('registra lineas pagadas con IDs reales y una identidad estable entre reintentos', async () => {
    const tokens = {
      getStoredConnectionBySellerId: jest.fn().mockResolvedValue({
        user_id: 'user-a',
        seller_id: 456,
      }),
      getValidAccessToken: jest.fn().mockResolvedValue('private-ml-token'),
    };
    const api = {
      get: jest.fn().mockResolvedValue({
        id: 2000001234567890,
        status: 'paid',
        date_closed: '2026-09-14T10:00:00-03:00',
        order_items: [
          {
            id: 'line-77',
            quantity: 2,
            item: {
              id: 'MLA1491447379',
              title: 'Remera',
              variation_id: 123456789,
              seller_sku: 'RM-NEG-M',
              variation_attributes: [
                { id: 'COLOR', value_name: 'Negro' },
                { id: 'SIZE', value_name: 'M' },
              ],
            },
          },
        ],
      }),
    };
    const publications = {
      getItemWithAllAttributes: jest.fn().mockResolvedValue({
        id: 'MLA1491447379',
        family_id: '7452953254396627',
        variations: [
          {
            id: 123456789,
            available_quantity: 4,
            user_product_id: 'MLAU123',
            attribute_combinations: [
              { id: 'COLOR', value_name: 'Negro' },
              { id: 'SIZE', value_name: 'M' },
            ],
          },
        ],
      }),
    };
    const saveMany = jest
      .fn<(records: readonly SaveRecentSale[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const sales = { saveMany };
    const links = { findByUserId: jest.fn().mockResolvedValue([]) };
    const service = new MercadolibreSaleIngestionService(
      tokens as unknown as MercadolibreTokenService,
      api as unknown as MercadolibreApiService,
      publications as unknown as PublicationSourceService,
      sales as unknown as RecentSalesRepository,
      links as unknown as VariantChannelLinksRepository,
    );

    await service.process('2000001234567890', 456);
    await service.process('2000001234567890', 456);

    expect(saveMany).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({
        channel: 'MERCADOLIBRE',
        externalOrderId: '2000001234567890',
        externalOrderItemId: 'line-77',
        mlItemId: 'MLA1491447379',
        mlVariationId: '123456789',
        familyId: '7452953254396627',
        userProductId: 'MLAU123',
        quantity: 2,
      }),
    ]);
    expect(saveMany).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        externalOrderId: '2000001234567890',
        externalOrderItemId: 'line-77',
      }),
    ]);
    expect(api.get).toHaveBeenCalledWith(
      '/orders/2000001234567890',
      'private-ml-token',
    );
  });

  it('ignora ordenes que aun no estan pagadas', async () => {
    const sales = { saveMany: jest.fn() };
    const service = new MercadolibreSaleIngestionService(
      {
        getStoredConnectionBySellerId: jest
          .fn()
          .mockResolvedValue({ user_id: 'user-a' }),
        getValidAccessToken: jest.fn().mockResolvedValue('token'),
      } as unknown as MercadolibreTokenService,
      {
        get: jest.fn().mockResolvedValue({
          id: 1,
          status: 'confirmed',
          order_items: [],
        }),
      } as unknown as MercadolibreApiService,
      {} as PublicationSourceService,
      sales as unknown as RecentSalesRepository,
      {} as VariantChannelLinksRepository,
    );

    await service.process('1', 456);

    expect(sales.saveMany).not.toHaveBeenCalled();
  });
});
