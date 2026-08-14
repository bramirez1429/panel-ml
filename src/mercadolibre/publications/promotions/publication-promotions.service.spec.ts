import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import type { PublicationManagementContext } from '../mutations/publication-management-target.service';
import { PublicationManagementTargetService } from '../mutations/publication-management-target.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationPromotionsService } from './publication-promotions.service';

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
} as unknown as PublicationManagementContext;
const PROMOTIONS_RESPONSE = {
  results: [
    {
      id: 'PROMO-1',
      type: 'PRICE_DISCOUNT',
      status: 'started',
      price: 800,
      original_price: 1_000,
      start_date: '2026-08-01',
      finish_date: '2026-08-14',
      name: 'Oferta agosto',
    },
  ],
};
const CANDIDATE_RESPONSE = {
  results: [
    {
      id: 'PROMO-CANDIDATE',
      type: 'PRICE_DISCOUNT',
      status: 'candidate',
      min_discounted_price: 700,
      max_discounted_price: 900,
    },
  ],
};

describe('PublicationPromotionsService', () => {
  const resolve = jest.fn();
  const resolveAll = jest.fn();
  const getOwnedItem = jest.fn();
  const getOptional = jest.fn();
  const post = jest.fn();
  const deleteRequest = jest.fn();
  const syncItem = jest.fn();
  const recordBestEffort = jest.fn();
  let service: PublicationPromotionsService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(CONTEXT);
    resolveAll.mockResolvedValue([CONTEXT]);
    getOwnedItem.mockResolvedValue({ id: 'MLA100', seller_id: 123 });
    getOptional.mockResolvedValue(PROMOTIONS_RESPONSE);
    post.mockResolvedValue({});
    syncItem.mockResolvedValue(undefined);
    recordBestEffort.mockResolvedValue(undefined);
    service = new PublicationPromotionsService(
      {
        resolve,
        resolveAll,
        getOwnedItem,
      } as unknown as PublicationManagementTargetService,
      {
        getOptional,
        post,
        delete: deleteRequest,
      } as unknown as MercadolibreApiService,
      { syncItem } as unknown as PublicationSyncService,
      { recordBestEffort } as unknown as PublicationActivityService,
    );
  });

  it('consulta seller-promotions y expone acciones solo para PRICE_DISCOUNT', async () => {
    const result = await service.get(PRODUCT_ID, undefined);

    expect(getOptional).toHaveBeenCalledWith(
      '/seller-promotions/items/MLA100?app_version=v2',
      'token',
    );
    expect(result.promotions).toEqual([
      expect.objectContaining({
        id: 'PROMO-1',
        type: 'PRICE_DISCOUNT',
        status: 'started',
        regularPrice: 1_000,
        promotionPrice: 800,
        percentage: 20,
        canApply: false,
        canRemove: true,
      }),
    ]);
  });

  it('devuelve una lista vacia cuando ML no tiene promociones para el MLA', async () => {
    getOptional.mockResolvedValueOnce(null);

    await expect(service.get(PRODUCT_ID, undefined)).resolves.toEqual({
      productId: PRODUCT_ID,
      promotions: [],
    });
  });

  it('aplica PRICE_DISCOUNT en ML antes de sincronizar y auditar exito', async () => {
    getOptional.mockResolvedValueOnce(CANDIDATE_RESPONSE);
    await service.applyPriceDiscount(PRODUCT_ID, {
      itemId: 'MLA100',
      dealPrice: 800,
      startDate: '2026-08-01',
      finishDate: '2026-08-14',
    });

    expect(post).toHaveBeenCalledWith(
      '/seller-promotions/items/MLA100?app_version=v2',
      {
        deal_price: 800,
        start_date: '2026-08-01',
        finish_date: '2026-08-14',
        promotion_type: 'PRICE_DISCOUNT',
      },
      'token',
      'promotionMutation',
    );
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(
      syncItem.mock.invocationCallOrder[0],
    );
    expect(syncItem).toHaveBeenCalledWith('MLA100', 123);
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROMOTION_APPLIED',
        status: 'SUCCESS',
      }),
    );
  });

  it('si ML falla no sincroniza y registra FAILED', async () => {
    const error = new Error('ML no disponible');
    getOptional.mockResolvedValueOnce(CANDIDATE_RESPONSE);
    post.mockRejectedValueOnce(error);

    await expect(
      service.applyPriceDiscount(PRODUCT_ID, {
        itemId: 'MLA100',
        dealPrice: 800,
        startDate: '2026-08-01',
        finishDate: '2026-08-14',
      }),
    ).rejects.toBe(error);

    expect(syncItem).not.toHaveBeenCalled();
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROMOTION_APPLIED',
        status: 'FAILED',
      }),
    );
  });

  it('si falla el sync luego del 2xx registra FAILED', async () => {
    const error = new Error('Supabase no disponible');
    getOptional.mockResolvedValueOnce(CANDIDATE_RESPONSE);
    syncItem.mockRejectedValueOnce(error);

    await expect(
      service.applyPriceDiscount(PRODUCT_ID, {
        itemId: 'MLA100',
        dealPrice: 800,
        startDate: '2026-08-01',
        finishDate: '2026-08-14',
      }),
    ).rejects.toBe(error);

    expect(post).toHaveBeenCalledTimes(1);
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROMOTION_APPLIED',
        status: 'FAILED',
      }),
    );
  });

  it('elimina un PRICE_DISCOUNT activo antes del sync dirigido', async () => {
    await service.removePriceDiscount(PRODUCT_ID, { itemId: 'MLA100' });

    expect(deleteRequest).toHaveBeenCalledWith(
      '/seller-promotions/items/MLA100?promotion_type=PRICE_DISCOUNT&app_version=v2',
      'token',
      'promotionMutation',
    );
    expect(syncItem).toHaveBeenCalledWith('MLA100', 123);
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROMOTION_REMOVED',
        status: 'SUCCESS',
      }),
    );
  });
});
