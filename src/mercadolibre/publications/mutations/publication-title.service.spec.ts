import { ConflictException } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationSnapshotService } from './publication-snapshot.service';
import { PublicationTitleService } from './publication-title.service';

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

describe('PublicationTitleService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const put = jest.fn();
  const syncKnownItem = jest.fn();
  const persist = jest.fn();
  const recordBestEffort = jest.fn();
  let service: PublicationTitleService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(CONTEXT);
    getOwnedItem.mockResolvedValue({
      id: 'MLA100',
      seller_id: 123,
      title: 'Anterior',
      status: 'active',
      sold_quantity: 0,
    });
    put.mockResolvedValue({
      id: 'MLA100',
      seller_id: 123,
      title: 'Titulo nuevo',
      status: 'active',
      pictures: [],
      variations: [],
      attributes: [],
    });
    service = new PublicationTitleService(
      { resolve, getOwnedItem } as unknown as PublicationManagementTargetService,
      { put } as unknown as MercadolibreApiService,
      { syncKnownItem } as unknown as PublicationSyncService,
      { persist } as unknown as PublicationSnapshotService,
      { recordBestEffort } as unknown as PublicationActivityService,
    );
  });

  it('confirma el titulo devuelto antes del sync dirigido', async () => {
    await service.update(PRODUCT_ID, { title: 'Titulo nuevo' });

    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      { title: 'Titulo nuevo' },
      'token',
      'titleMutation',
    );
    expect(syncKnownItem).toHaveBeenCalledTimes(1);
  });

  it('no sincroniza si ML no refleja el titulo solicitado', async () => {
    put.mockResolvedValueOnce({
      id: 'MLA100',
      seller_id: 123,
      title: 'Anterior',
    });

    await expect(
      service.update(PRODUCT_ID, { title: 'Titulo nuevo' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(syncKnownItem).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
