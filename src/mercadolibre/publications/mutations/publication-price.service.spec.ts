import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationOfficialPriceService } from '../prices/publication-official-price.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationPriceService } from './publication-price.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SELLER_ID = 123;
const TOKEN = 'access-token';
const CONTEXT = {
  product: {
    id: PRODUCT_ID,
    model: 'SHARED',
    parent_item_id: 'MLA100',
    shared_variations: [{ id: '10' }, { id: '20' }],
  },
  target: {
    productId: PRODUCT_ID,
    model: 'SHARED',
    itemId: 'MLA100',
    userProductId: null,
  },
  sellerId: SELLER_ID,
  accessToken: TOKEN,
};

describe('PublicationPriceService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const put = jest.fn();
  const syncKnownItem = jest.fn();
  const recordBestEffort = jest.fn();
  const readOfficialPrice = jest.fn();
  let service: PublicationPriceService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(CONTEXT);
    getOwnedItem.mockResolvedValue({
      id: 'MLA100',
      seller_id: SELLER_ID,
      tags: [],
      variations: [],
    });
    put.mockResolvedValue({
      id: 'MLA100',
      seller_id: SELLER_ID,
      tags: [],
      variations: [],
    });
    readOfficialPrice.mockImplementation((publication: unknown) => ({
      publication,
      standardPrice: 48_000,
      salePrice: 48_000,
    }));
    service = new PublicationPriceService(
      {
        resolve,
        getOwnedItem,
      } as unknown as PublicationManagementTargetService,
      { put } as unknown as MercadolibreApiService,
      { syncKnownItem } as unknown as PublicationSyncService,
      { recordBestEffort } as unknown as PublicationActivityService,
      { read: readOfficialPrice } as unknown as PublicationOfficialPriceService,
    );
  });

  it('acepta un precio válido y preserva todos los IDs SHARED', async () => {
    const variations = [
      { id: 10, available_quantity: 4 },
      { id: '20', available_quantity: 7 },
    ];
    getOwnedItem.mockResolvedValue({
      id: 'MLA100',
      seller_id: SELLER_ID,
      tags: [],
      variations,
    });
    put.mockResolvedValue({
      id: 'MLA100',
      seller_id: SELLER_ID,
      tags: [],
      variations,
    });

    await expect(
      service.update(PRODUCT_ID, { price: 48_000 }),
    ).resolves.toMatchObject({
      ok: true,
      field: 'price',
      value: 48_000,
    });
    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      {
        variations: [
          { id: 10, price: 48_000 },
          { id: '20', price: 48_000 },
        ],
      },
      TOKEN,
      'priceMutation',
    );
    expect(syncKnownItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'MLA100', seller_id: SELLER_ID }),
      { sellerId: SELLER_ID, accessToken: TOKEN },
      true,
    );
  });

  it.each([0, -1, Number.NaN])(
    'rechaza el precio inválido %s',
    async (price) => {
      await expect(
        service.update(PRODUCT_ID, { price }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it('rechaza dynamic_standard_price antes del PUT', async () => {
    getOwnedItem.mockResolvedValue({
      id: 'MLA100',
      seller_id: SELLER_ID,
      tags: ['dynamic_standard_price'],
      variations: [],
    });

    await expect(
      service.update(PRODUCT_ID, { price: 50_000 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(put).not.toHaveBeenCalled();
    expect(syncKnownItem).not.toHaveBeenCalled();
  });

  it('no escribe ni sincroniza si el item no pertenece al producto', async () => {
    resolve.mockRejectedValue(new NotFoundException('item ajeno'));

    await expect(
      service.update(PRODUCT_ID, { price: 35_500, itemId: 'MLA999' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(getOwnedItem).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('no sincroniza Supabase si Mercado Libre falla', async () => {
    const error = new Error('ML failed');
    put.mockRejectedValue(error);

    await expect(service.update(PRODUCT_ID, { price: 48_000 })).rejects.toBe(
      error,
    );
    expect(syncKnownItem).not.toHaveBeenCalled();
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PRICE_UPDATED', status: 'FAILED' }),
    );
  });

  it('no sincroniza si el precio standard oficial no cambió', async () => {
    readOfficialPrice.mockResolvedValueOnce({
      publication: { id: 'MLA100', seller_id: SELLER_ID, price: 40_000 },
      standardPrice: 40_000,
      salePrice: 40_000,
    });

    await expect(
      service.update(PRODUCT_ID, { price: 48_000 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(syncKnownItem).not.toHaveBeenCalled();
  });
});
