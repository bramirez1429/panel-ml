import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import type {
  MercadolibreChildRow,
  MercadolibreProductDetail,
} from '../../../database/repositories/mercadolibre-publications.types';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import { PublicationManagementReaderService } from './publication-management-reader.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationSnapshotService } from './publication-snapshot.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const FRESH = new Date().toISOString();
const STALE = '2020-01-01T00:00:00.000Z';

describe('PublicationManagementReaderService', () => {
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const persist = jest.fn();
  const findById = jest.fn();
  const findByProductId = jest.fn();
  let service: PublicationManagementReaderService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new PublicationManagementReaderService(
      {
        resolve,
        getOwnedItem,
      } as unknown as PublicationManagementTargetService,
      { persist } as unknown as PublicationSnapshotService,
      { findById } as unknown as MercadolibreProductsRepository,
      { findByProductId } as unknown as MercadolibreChildrenRepository,
    );
  });

  it('devuelve el snapshot SHARED guardado con el mismo shape si esta fresco', async () => {
    const stored = product({
      management_synced_at: FRESH,
      pictures: [{ id: 'PIC-1' }],
      shared_skus: { __item__: 'SKU-1' },
    });

    await expect(service.hydrate(stored, ['MLA100'])).resolves.toEqual({
      itemIds: ['MLA100'],
      status: 'active',
      pictures: [{ id: 'PIC-1' }],
      sku: 'SKU-1',
      sharedSkus: { __item__: 'SKU-1' },
      refreshedAt: FRESH,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it('relee el snapshot SHARED persistido en vez de devolver un array live', async () => {
    const stale = product({ management_synced_at: STALE });
    const refreshed = product({
      management_synced_at: FRESH,
      status: 'paused',
      shared_skus: { __item__: 'SKU-NUEVO' },
    });
    const context = targetContext('MLA100');
    resolve.mockResolvedValue(context);
    getOwnedItem.mockResolvedValue({ id: 'MLA100' });
    persist.mockResolvedValue({ itemId: 'MLA100' });
    findById.mockResolvedValue(refreshed);

    const result = await service.hydrate(stale, ['MLA100']);

    expect(persist).toHaveBeenCalledWith(context.target, { id: 'MLA100' });
    expect(findById).toHaveBeenCalledWith(123, PRODUCT_ID);
    expect(result).toMatchObject({
      itemIds: ['MLA100'],
      status: 'paused',
      sku: 'SKU-NUEVO',
      refreshedAt: FRESH,
    });
    expect(Array.isArray(result)).toBe(false);
  });

  it('refresca solamente el hijo stale y devuelve todos los targets guardados', async () => {
    const freshChild = child('MLA100', FRESH, 'SKU-1');
    const staleChild = child('MLA200', STALE, 'SKU-2');
    const refreshedChild = child('MLA200', FRESH, 'SKU-NUEVO');
    const context = targetContext('MLA200');
    findByProductId
      .mockResolvedValueOnce([freshChild, staleChild])
      .mockResolvedValueOnce([freshChild, refreshedChild]);
    resolve.mockResolvedValue(context);
    getOwnedItem.mockResolvedValue({ id: 'MLA200' });
    persist.mockResolvedValue({ itemId: 'MLA200' });

    const result = await service.hydrate(
      product({ model: 'VARIANT_PRICING' }),
      ['MLA100', 'MLA200'],
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(PRODUCT_ID, 'MLA200');
    expect(result).toEqual([
      childView('MLA100', FRESH, 'SKU-1'),
      childView('MLA200', FRESH, 'SKU-NUEVO'),
    ]);
  });

  it('conserva la coleccion completa si falla el refresh de un target', async () => {
    const first = child('MLA100', STALE, 'SKU-1');
    const second = child('MLA200', STALE, 'SKU-2');
    findByProductId.mockResolvedValue([first, second]);
    resolve.mockImplementation((_productId: string, itemId: string) =>
      Promise.resolve(targetContext(itemId)),
    );
    getOwnedItem
      .mockRejectedValueOnce(new Error('ML caido'))
      .mockResolvedValueOnce({ id: 'MLA200' });
    persist.mockResolvedValue({ itemId: 'MLA200' });

    const result = await service.hydrate(
      product({ model: 'VARIANT_PRICING' }),
      ['MLA100', 'MLA200'],
    );

    expect(result).toEqual([
      childView('MLA100', STALE, 'SKU-1'),
      childView('MLA200', STALE, 'SKU-2'),
    ]);
    expect(result).toHaveLength(2);
  });
});

function product(
  overrides: Partial<MercadolibreProductDetail> = {},
): MercadolibreProductDetail {
  return {
    id: PRODUCT_ID,
    seller_id: 123,
    model: 'SHARED',
    parent_item_id: 'MLA100',
    status: 'active',
    pictures: [],
    shared_skus: {},
    management_synced_at: STALE,
    ...overrides,
  } as MercadolibreProductDetail;
}

function child(itemId: string, refreshedAt: string, sku: string) {
  return {
    item_id: itemId,
    status: 'active',
    pictures: [],
    attributes: [{ id: 'SELLER_SKU', value_name: sku }],
    management_synced_at: refreshedAt,
  } as MercadolibreChildRow;
}

function childView(itemId: string, refreshedAt: string, sku: string) {
  return { itemId, status: 'active', pictures: [], sku, refreshedAt };
}

function targetContext(itemId: string) {
  return {
    target: {
      productId: PRODUCT_ID,
      model: 'VARIANT_PRICING' as const,
      itemId,
      userProductId: `MLAU${itemId.slice(3)}`,
    },
    sellerId: 123,
    accessToken: 'token',
  };
}
