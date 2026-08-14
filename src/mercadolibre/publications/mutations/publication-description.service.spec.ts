import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationDescriptionService } from './publication-description.service';
import { PublicationLiveContentService } from './publication-live-content.service';
import { PublicationManagementTargetService } from './publication-management-target.service';

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

describe('PublicationDescriptionService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const getDescription = jest.fn();
  const post = jest.fn();
  const put = jest.fn();
  const syncItem = jest.fn();
  const recordBestEffort = jest.fn();
  let service: PublicationDescriptionService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(CONTEXT);
    getOwnedItem.mockResolvedValue({ id: 'MLA100', seller_id: 123 });
    getDescription
      .mockResolvedValueOnce('Anterior')
      .mockResolvedValueOnce('Nueva descripcion');
    service = new PublicationDescriptionService(
      { resolve, getOwnedItem } as unknown as PublicationManagementTargetService,
      { post, put } as unknown as MercadolibreApiService,
      { getDescription } as unknown as PublicationLiveContentService,
      { syncItem } as unknown as PublicationSyncService,
      { recordBestEffort } as unknown as PublicationActivityService,
    );
  });

  it('reemplaza una descripcion con api_version 2 y luego sincroniza', async () => {
    await service.update(PRODUCT_ID, { description: 'Nueva descripcion' });

    expect(put).toHaveBeenCalledWith(
      '/items/MLA100/description?api_version=2',
      { plain_text: 'Nueva descripcion' },
      'token',
      'descriptionMutation',
    );
    expect(syncItem).toHaveBeenCalledWith('MLA100', 123);
  });

  it('no sincroniza cuando ML rechaza la descripcion', async () => {
    const error = new Error('ML fallo');
    put.mockRejectedValueOnce(error);

    await expect(
      service.update(PRODUCT_ID, { description: 'Nueva descripcion' }),
    ).rejects.toBe(error);
    expect(syncItem).not.toHaveBeenCalled();
  });
});
