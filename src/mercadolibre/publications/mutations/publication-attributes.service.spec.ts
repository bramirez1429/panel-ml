import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationAttributesService } from './publication-attributes.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationSnapshotService } from './publication-snapshot.service';

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
const LIVE = {
  id: 'MLA100',
  seller_id: 123,
  category_id: 'MLA1234',
  status: 'active',
  attributes: [
    { id: 'BRAND', value_name: 'Anterior' },
    { id: 'GTIN', value_name: '7790000000000' },
  ],
  pictures: [],
  variations: [],
};

describe('PublicationAttributesService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const get = jest.fn();
  const put = jest.fn();
  const syncKnownItem = jest.fn();
  const persist = jest.fn();
  const recordBestEffort = jest.fn();
  let service: PublicationAttributesService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(CONTEXT);
    getOwnedItem.mockResolvedValue(LIVE);
    get.mockResolvedValue([{ id: 'BRAND', name: 'Marca', tags: {} }]);
    put.mockResolvedValue({
      ...LIVE,
      attributes: [
        { id: 'BRAND', value_name: 'Nueva' },
        { id: 'GTIN', value_name: '7790000000000' },
      ],
    });
    service = new PublicationAttributesService(
      { resolve, getOwnedItem } as unknown as PublicationManagementTargetService,
      { get, put } as unknown as MercadolibreApiService,
      { syncKnownItem } as unknown as PublicationSyncService,
      { persist } as unknown as PublicationSnapshotService,
      { recordBestEffort } as unknown as PublicationActivityService,
    );
  });

  it('modifica solo el atributo pedido y preserva los restantes', async () => {
    await service.update(PRODUCT_ID, {
      attributes: [{ id: 'BRAND', valueName: 'Nueva' }],
    });

    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      {
        attributes: [
          { id: 'BRAND', value_name: 'Nueva' },
          { id: 'GTIN', value_name: '7790000000000' },
        ],
      },
      'token',
      'attributesMutation',
    );
    expect(syncKnownItem).toHaveBeenCalledTimes(1);
  });

  it('no sincroniza cuando ML rechaza los atributos', async () => {
    const error = new Error('ML fallo');
    put.mockRejectedValueOnce(error);

    await expect(
      service.update(PRODUCT_ID, {
        attributes: [{ id: 'BRAND', valueName: 'Nueva' }],
      }),
    ).rejects.toBe(error);
    expect(syncKnownItem).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
