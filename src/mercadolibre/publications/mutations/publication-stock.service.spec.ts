import { BadRequestException } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationStockService } from './publication-stock.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SELLER_ID = 123;
const TOKEN = 'access-token';

describe('PublicationStockService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const get = jest.fn();
  const getWithHeaders = jest.fn();
  const put = jest.fn();
  const putWithHeaders = jest.fn();
  const syncKnownItem = jest.fn();
  const syncItem = jest.fn();
  const recordBestEffort = jest.fn();
  let service: PublicationStockService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolve.mockResolvedValue(context('SHARED', null));
    getOwnedItem.mockResolvedValue(item([]));
    get.mockResolvedValue({ id: SELLER_ID, tags: [] });
    getWithHeaders.mockResolvedValue({ data: null, headers: new Headers() });
    put.mockResolvedValue(item([]));
    service = new PublicationStockService(
      {
        resolve,
        getOwnedItem,
      } as unknown as PublicationManagementTargetService,
      {
        get,
        getWithHeaders,
        put,
        putWithHeaders,
      } as unknown as MercadolibreApiService,
      { syncKnownItem, syncItem } as unknown as PublicationSyncService,
      { recordBestEffort } as unknown as PublicationActivityService,
    );
  });

  it('acepta stock cero y sincroniza la respuesta conocida del PUT', async () => {
    await expect(
      service.update(PRODUCT_ID, { stock: 0 }),
    ).resolves.toMatchObject({
      ok: true,
      field: 'stock',
      value: 0,
    });
    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      { available_quantity: 0 },
      TOKEN,
      'stockMutation',
    );
    expect(syncKnownItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'MLA100' }),
      {
        sellerId: SELLER_ID,
        accessToken: TOKEN,
      },
    );
  });

  it('rechaza stock negativo antes de resolver el producto', async () => {
    await expect(
      service.update(PRODUCT_ID, { stock: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('SHARED preserva todos los IDs y cambia sólo la variation elegida', async () => {
    const variations = [
      { id: 10, available_quantity: 4 },
      { id: 20, available_quantity: 7 },
    ];
    getOwnedItem.mockResolvedValue(item(variations));
    put.mockResolvedValue(item(variations));

    await service.update(PRODUCT_ID, { stock: 12, variationId: '20' });

    expect(put).toHaveBeenCalledWith(
      '/items/MLA100',
      { variations: [{ id: 10 }, { id: 20, available_quantity: 12 }] },
      TOKEN,
      'stockMutation',
    );
  });

  it.each([
    ['VARIANT_PRICING', null, 'MLAU300'],
    ['SHARED', '20', null],
  ] as const)(
    'actualiza selling_address con x-version para %s',
    async (model, variationId, targetUserProductId) => {
      resolve.mockResolvedValue(context(model, targetUserProductId));
      const variations = variationId
        ? [{ id: 20, available_quantity: 7, user_product_id: 'MLAU300' }]
        : [];
      getOwnedItem.mockResolvedValue(
        item(variations, model === 'VARIANT_PRICING' ? 'MLA200' : 'MLA100'),
      );
      getWithHeaders.mockResolvedValue({
        data: {
          locations: [{ type: 'meli_facility' }, { type: 'selling_address' }],
        },
        headers: new Headers({ 'x-version': '7' }),
      });

      await service.update(PRODUCT_ID, {
        stock: 9,
        itemId: model === 'VARIANT_PRICING' ? 'MLA200' : undefined,
        variationId,
      });

      expect(getWithHeaders).toHaveBeenCalledWith(
        '/user-products/MLAU300/stock',
        TOKEN,
        true,
      );
      expect(putWithHeaders).toHaveBeenCalledWith(
        '/user-products/MLAU300/stock/type/selling_address',
        { quantity: 9 },
        TOKEN,
        { 'x-version': '7' },
        'stockMutation',
      );
      expect(put).not.toHaveBeenCalled();
      expect(syncItem).toHaveBeenCalled();
    },
  );

  it.each([
    [[{ type: 'seller_warehouse' }], 'depósito'],
    [[{ type: 'meli_facility' }], 'Full'],
  ])('bloquea locations no administrables %j', async (locations, message) => {
    resolve.mockResolvedValue(context('VARIANT_PRICING', 'MLAU300'));
    getOwnedItem.mockResolvedValue(item([], 'MLA200'));
    getWithHeaders.mockResolvedValue({
      data: { locations },
      headers: new Headers({ 'x-version': '3' }),
    });

    await expect(
      service.update(PRODUCT_ID, { stock: 4, itemId: 'MLA200' }),
    ).rejects.toThrow(message);
    expect(put).not.toHaveBeenCalled();
    expect(putWithHeaders).not.toHaveBeenCalled();
  });

  it('ante 404 de stock distribuido usa PUT /items', async () => {
    resolve.mockResolvedValue(context('VARIANT_PRICING', 'MLAU300'));
    getOwnedItem.mockResolvedValue(item([], 'MLA200'));
    put.mockResolvedValue({
      ...item([], 'MLA200'),
      user_product_id: 'MLAU300',
    });

    await service.update(PRODUCT_ID, { stock: 3, itemId: 'MLA200' });

    expect(getWithHeaders).toHaveBeenCalledWith(
      '/user-products/MLAU300/stock',
      TOKEN,
      true,
    );
    expect(put).toHaveBeenCalled();
  });

  it('no sincroniza Supabase si Mercado Libre falla', async () => {
    put.mockRejectedValue(new Error('ML failed'));

    await expect(service.update(PRODUCT_ID, { stock: 2 })).rejects.toThrow(
      'ML failed',
    );
    expect(syncKnownItem).not.toHaveBeenCalled();
    expect(syncItem).not.toHaveBeenCalled();
  });
});

function context(
  model: 'SHARED' | 'VARIANT_PRICING',
  userProductId: string | null,
) {
  const itemId = model === 'SHARED' ? 'MLA100' : 'MLA200';
  return {
    product: {
      id: PRODUCT_ID,
      model,
      parent_item_id: model === 'SHARED' ? itemId : null,
      shared_variations: model === 'SHARED' ? [{ id: '20' }] : [],
    },
    target: { productId: PRODUCT_ID, model, itemId, userProductId },
    sellerId: SELLER_ID,
    accessToken: TOKEN,
  };
}

function item(variations: unknown[], id = 'MLA100') {
  return { id, seller_id: SELLER_ID, tags: [], variations };
}
