import { BadRequestException, ConflictException } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationPictureUploadService } from './publication-picture-upload.service';
import { PublicationPicturesService } from './publication-pictures.service';
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
  pictures: [{ id: 'P1' }, { id: 'P2' }],
  variations: [
    { id: 10, attributes: [], picture_ids: ['P1'] },
    { id: 20, attributes: [], picture_ids: ['P2'] },
  ],
};

describe('PublicationPicturesService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const put = jest.fn();
  const postMultipart = jest.fn();
  const syncKnownItem = jest.fn();
  const persist = jest.fn();
  const recordBestEffort = jest.fn();
  const upload = jest.fn();
  let service: PublicationPicturesService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(CONTEXT);
    getOwnedItem.mockResolvedValue(LIVE);
    put.mockResolvedValue({
      ...LIVE,
      pictures: [{ id: 'P3' }, { id: 'P2' }],
      variations: [
        { id: 10, attributes: [], picture_ids: ['P3'] },
        { id: 20, attributes: [], picture_ids: ['P2'] },
      ],
      attributes: [],
    });
    recordBestEffort.mockResolvedValue(undefined);
    service = new PublicationPicturesService(
      {
        resolve,
        getOwnedItem,
      } as unknown as PublicationManagementTargetService,
      { put, postMultipart } as unknown as MercadolibreApiService,
      { persist } as unknown as PublicationSnapshotService,
      { syncKnownItem } as unknown as PublicationSyncService,
      { recordBestEffort } as unknown as PublicationActivityService,
      { upload } as unknown as PublicationPictureUploadService,
    );
  });

  it('reemplaza el ID en galeria y todas sus referencias', async () => {
    await service.replace(PRODUCT_ID, {
      pictureId: 'P1',
      replacementPictureId: 'P3',
    });

    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      {
        pictures: [{ id: 'P3' }, { id: 'P2' }],
        variations: [
          { id: 10, picture_ids: ['P3'] },
          { id: 20, picture_ids: ['P2'] },
        ],
      },
      'token',
      'picturesMutation',
    );
    expect(syncKnownItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'MLA100' }),
      { sellerId: 123, accessToken: 'token' },
    );
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PICTURES_UPDATED',
        status: 'SUCCESS',
        oldValue: {
          pictureIds: ['P1', 'P2'],
          variations: [
            { variationId: '10', pictureIds: ['P1'] },
            { variationId: '20', pictureIds: ['P2'] },
          ],
        },
      }),
    );
  });

  it('rechaza reorder que no es una permutacion exacta', async () => {
    await expect(
      service.reorder(PRODUCT_ID, { pictureIds: ['P1', 'P3'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(put).not.toHaveBeenCalled();
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PICTURES_UPDATED',
        status: 'FAILED',
      }),
    );
  });

  it('no permite dejar una variacion sin imagen', async () => {
    await expect(
      service.remove(PRODUCT_ID, { pictureId: 'P1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(put).not.toHaveBeenCalled();
  });

  it('agrega la imagen subida reutilizando la unica lectura viva', async () => {
    upload.mockResolvedValueOnce({
      context: CONTEXT,
      input: { itemId: undefined, variationId: null },
      live: LIVE,
      pictureId: 'P3',
    });

    await service.update(
      PRODUCT_ID,
      { operation: 'upload' },
      {
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        mimetype: 'image/jpeg',
        originalname: 'new.jpg',
        size: 3,
      },
    );

    expect(getOwnedItem).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      {
        pictures: [{ id: 'P1' }, { id: 'P2' }, { id: 'P3' }],
        variations: [
          { id: 10, picture_ids: ['P1'] },
          { id: 20, picture_ids: ['P2'] },
        ],
      },
      'token',
      'picturesMutation',
    );
  });

  it('valida MIME y magic bytes antes de subir', async () => {
    const uploader = new PublicationPictureUploadService(
      { resolve, getOwnedItem } as unknown as PublicationManagementTargetService,
      { postMultipart } as unknown as MercadolibreApiService,
      { recordBestEffort } as unknown as PublicationActivityService,
    );
    await expect(
      uploader.upload(
        PRODUCT_ID,
        {},
        {
          buffer: Buffer.from('not-a-png'),
          mimetype: 'image/png',
          originalname: 'bad.png',
          size: 9,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resolve).not.toHaveBeenCalled();
    expect(postMultipart).not.toHaveBeenCalled();
  });
});
