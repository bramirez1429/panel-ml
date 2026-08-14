import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationSnapshotService } from './publication-snapshot.service';
import { PublicationSkuService } from './publication-sku.service';

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
};

describe('PublicationSkuService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const put = jest.fn();
  const syncKnownItem = jest.fn();
  const persist = jest.fn();
  const recordBestEffort = jest.fn();
  let service: PublicationSkuService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(CONTEXT);
    getOwnedItem
      .mockResolvedValueOnce({
        id: 'MLA100',
        seller_id: 123,
        variations: [
          {
            id: 10,
            attributes: [{ id: 'GTIN', value_name: '1' }],
            picture_ids: ['P1'],
          },
          {
            id: 20,
            attributes: [
              { id: 'GTIN', value_name: '2' },
              { id: 'SELLER_SKU', value_name: 'OLD' },
            ],
            picture_ids: ['P2'],
            sold_quantity: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'MLA100',
        seller_id: 123,
        variations: [],
        pictures: [],
        attributes: [],
      });
    put.mockResolvedValue({
      id: 'MLA100',
      seller_id: 123,
      pictures: [],
      attributes: [],
      variations: [
        {
          id: 10,
          attributes: [{ id: 'GTIN', value_name: '1' }],
          picture_ids: ['P1'],
        },
        {
          id: 20,
          attributes: [
            { id: 'GTIN', value_name: '2' },
            { id: 'SELLER_SKU', value_name: 'NEW' },
          ],
          picture_ids: ['P2'],
        },
      ],
    });
    recordBestEffort.mockResolvedValue(undefined);
    service = new PublicationSkuService(
      {
        resolve,
        getOwnedItem,
      } as unknown as PublicationManagementTargetService,
      { put } as unknown as MercadolibreApiService,
      { persist } as unknown as PublicationSnapshotService,
      { syncKnownItem } as unknown as PublicationSyncService,
      { recordBestEffort } as unknown as PublicationActivityService,
    );
  });

  it('preserva IDs y todos los atributos de la variacion elegida', async () => {
    await service.update(PRODUCT_ID, { sku: 'NEW', variationId: '20' });

    expect(getOwnedItem).toHaveBeenNthCalledWith(1, CONTEXT, true);
    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      {
        variations: [
          { id: 10 },
          {
            id: 20,
            attributes: [
              { id: 'GTIN', value_name: '2' },
              { id: 'SELLER_SKU', value_name: 'NEW' },
            ],
          },
        ],
      },
      'token',
      'skuMutation',
    );
    expect(syncKnownItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'MLA100' }),
      { sellerId: 123, accessToken: 'token' },
    );
    expect(getOwnedItem).toHaveBeenCalledTimes(1);
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SKU_UPDATED',
        status: 'SUCCESS',
        oldValue: { variationId: '20', sku: 'OLD' },
        newValue: { sku: 'NEW', variationId: '20' },
      }),
    );
  });

  it('actualiza el item hijo UP preservando todos sus atributos', async () => {
    const variantContext = {
      ...CONTEXT,
      target: {
        ...CONTEXT.target,
        model: 'VARIANT_PRICING' as const,
        itemId: 'MLA200',
        userProductId: 'MLAU300',
      },
    };
    resolve.mockResolvedValue(variantContext);
    getOwnedItem.mockReset().mockResolvedValue({
      id: 'MLA200',
      seller_id: 123,
      user_product_id: 'MLAU300',
      attributes: [
        { id: 'COLOR', value_name: 'Negro' },
        { id: 'SELLER_SKU', value_name: 'OLD' },
      ],
      variations: [],
      pictures: [],
    });
    put.mockResolvedValue({
      id: 'MLA200',
      seller_id: 123,
      user_product_id: 'MLAU300',
      attributes: [
        { id: 'COLOR', value_name: 'Negro' },
        { id: 'SELLER_SKU', value_name: 'UP-NEW' },
      ],
      variations: [],
      pictures: [],
    });

    await service.update(PRODUCT_ID, { sku: 'UP-NEW', itemId: 'MLA200' });

    expect(put).toHaveBeenCalledWith(
      '/items/MLA200',
      {
        attributes: [
          { id: 'COLOR', value_name: 'Negro' },
          { id: 'SELLER_SKU', value_name: 'UP-NEW' },
        ],
      },
      'token',
      'skuMutation',
    );
    expect(syncKnownItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'MLA200' }),
      { sellerId: 123, accessToken: 'token' },
    );
  });

  it('no sincroniza Supabase si ML rechaza el SKU', async () => {
    const error = new Error('ML rechazó el SKU');
    put.mockRejectedValueOnce(error);

    await expect(
      service.update(PRODUCT_ID, { sku: 'NEW', variationId: '20' }),
    ).rejects.toBe(error);

    expect(syncKnownItem).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
