import { ConflictException } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationSnapshotService } from './publication-snapshot.service';
import { PublicationStatusService } from './publication-status.service';

const CONTEXT = {
  target: {
    productId: '11111111-1111-4111-8111-111111111111',
    model: 'SHARED' as const,
    itemId: 'MLA100',
    userProductId: null,
  },
  sellerId: 123,
  accessToken: 'token',
};

describe('PublicationStatusService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const put = jest.fn();
  const syncKnownItem = jest.fn();
  const persist = jest.fn();
  const recordBestEffort = jest.fn();
  let service: PublicationStatusService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(CONTEXT);
    getOwnedItem
      .mockResolvedValueOnce({
        id: 'MLA100',
        seller_id: 123,
        status: 'active',
        sub_status: [],
      })
      .mockResolvedValueOnce({
        id: 'MLA100',
        seller_id: 123,
        status: 'paused',
        pictures: [],
        variations: [],
        attributes: [],
      });
    put.mockResolvedValue({
      id: 'MLA100',
      seller_id: 123,
      status: 'paused',
      pictures: [],
      variations: [],
      attributes: [],
    });
    persist.mockResolvedValue({ status: 'paused' });
    recordBestEffort.mockResolvedValue(undefined);
    service = new PublicationStatusService(
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

  it('pausa y sincroniza usando la respuesta exitosa de ML', async () => {
    await service.update(CONTEXT.target.productId, { status: 'paused' });

    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      { status: 'paused' },
      'token',
      'statusMutation',
    );
    expect(syncKnownItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'MLA100', status: 'paused' }),
      { sellerId: 123, accessToken: 'token' },
    );
    expect(getOwnedItem).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      CONTEXT.target,
      expect.objectContaining({ status: 'paused' }),
    );
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAUSED',
        status: 'SUCCESS',
        oldValue: { status: 'active', subStatus: [] },
        newValue: { status: 'paused' },
      }),
    );
  });

  it('activa una publicación pausada', async () => {
    getOwnedItem.mockReset().mockResolvedValue({
      id: 'MLA100',
      seller_id: 123,
      status: 'paused',
      sub_status: [],
    });
    put.mockResolvedValue({
      id: 'MLA100',
      seller_id: 123,
      status: 'active',
      pictures: [],
      variations: [],
      attributes: [],
    });

    await service.update(CONTEXT.target.productId, { status: 'active' });

    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      { status: 'active' },
      'token',
      'activationMutation',
    );
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ACTIVATED', status: 'SUCCESS' }),
    );
  });

  it('rechaza un estado fuera del contrato antes de resolver el target', async () => {
    await expect(
      service.update(CONTEXT.target.productId, { status: 'closed' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(resolve).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'closed', sub_status: [] }, 'active'],
    [{ status: 'under_review', sub_status: ['waiting_for_patch'] }, 'active'],
    [{ status: 'paused', sub_status: ['out_of_stock'] }, 'active'],
    [{ status: 'paused', sub_status: ['picture_download_pending'] }, 'active'],
  ])(
    'bloquea estados que no admiten activacion directa',
    async (item, status) => {
      getOwnedItem.mockReset().mockResolvedValue(item);
      await expect(
        service.update(CONTEXT.target.productId, { status }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(put).not.toHaveBeenCalled();
      expect(recordBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ACTIVATED',
          status: 'FAILED',
        }),
      );
    },
  );
});
