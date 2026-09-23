import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { StockLocation } from '../stock/stock.types';
import { StockBulkPreviewStockService } from './stock-bulk-preview-stock.service';
import type { StockBulkTarget } from './stock-bulk.types';

describe('StockBulkPreviewStockService', () => {
  it('resuelve 10 USER_PRODUCT sin consultar items ni StockService', async () => {
    const api = apiMock(() =>
      stockResponse([{ type: 'selling_address', quantity: 3 }]),
    );
    const itemsService = { getOne: jest.fn() };
    const stockService = { getNewStock: jest.fn() };
    const service = new StockBulkPreviewStockService(
      api as unknown as MercadolibreApiService,
    );

    const results = await service.resolve(
      'access-token',
      Array.from({ length: 10 }, (_, index) => target(index)),
    );

    expect(results).toHaveLength(10);
    expect(results.every(({ currentQuantity }) => currentQuantity === 3)).toBe(
      true,
    );
    expect(api.getWithMeta).toHaveBeenCalledTimes(10);
    expect(
      api.getWithMeta.mock.calls.every(([path]) =>
        String(path).startsWith('/user-products/'),
      ),
    ).toBe(true);
    expect(itemsService.getOne).not.toHaveBeenCalled();
    expect(stockService.getNewStock).not.toHaveBeenCalled();
  });

  it('no hace requests para LEGACY y mantiene currentQuantity', async () => {
    const api = apiMock(() => stockResponse([]));
    const service = new StockBulkPreviewStockService(
      api as unknown as MercadolibreApiService,
    );
    const legacy = target(1, {
      model: 'LEGACY',
      userProductId: null,
      familyId: null,
      variationId: '123',
      currentQuantity: 7,
    });

    await expect(service.resolve('access-token', [legacy])).resolves.toEqual([
      legacy,
    ]);
    expect(api.getWithMeta).not.toHaveBeenCalled();
  });

  it('guarda storeId y networkNodeId de un seller_warehouse v\u00e1lido', async () => {
    const api = apiMock(() =>
      stockResponse([
        {
          type: 'seller_warehouse',
          quantity: 8,
          store_id: 'STORE-1',
          network_node_id: 'NODE-1',
        },
      ]),
    );
    const service = new StockBulkPreviewStockService(
      api as unknown as MercadolibreApiService,
    );

    const [result] = await service.resolve('access-token', [target(1)]);

    expect(result).toEqual(
      expect.objectContaining({
        currentQuantity: 8,
        storeId: 'STORE-1',
        networkNodeId: 'NODE-1',
        editable: true,
      }),
    );
  });

  it('marca m\u00faltiples seller_warehouse como no editables', async () => {
    const api = apiMock(() =>
      stockResponse([
        warehouse('STORE-1', 'NODE-1'),
        warehouse('STORE-2', 'NODE-2'),
      ]),
    );
    const service = new StockBulkPreviewStockService(
      api as unknown as MercadolibreApiService,
    );

    const [result] = await service.resolve('access-token', [target(1)]);

    expect(result).toEqual(
      expect.objectContaining({
        editable: false,
        reason: 'MULTIPLE_STOCK_LOCATIONS',
      }),
    );
  });

  it('a\u00edsla el error de un target y contin\u00faa con los dem\u00e1s', async () => {
    const api = apiMock((path) => {
      if (path.includes('MLAU-1')) throw new Error('unavailable');
      return stockResponse([{ type: 'selling_address', quantity: 4 }]);
    });
    const service = new StockBulkPreviewStockService(
      api as unknown as MercadolibreApiService,
    );

    const results = await service.resolve('access-token', [
      target(0),
      target(1),
      target(2),
    ]);

    expect(results[1]).toEqual(
      expect.objectContaining({
        editable: false,
        reason: 'STOCK_UNAVAILABLE',
      }),
    );
    expect(results[0]).toEqual(
      expect.objectContaining({ editable: true, currentQuantity: 4 }),
    );
    expect(results[2]).toEqual(
      expect.objectContaining({ editable: true, currentQuantity: 4 }),
    );
  });

  it('cachea por userProductId dentro del preview', async () => {
    const api = apiMock(() => stockResponse([]));
    const service = new StockBulkPreviewStockService(
      api as unknown as MercadolibreApiService,
    );

    await service.resolve('access-token', [
      target(1, { identifier: 'first', userProductId: 'MLAU-SHARED' }),
      target(2, { identifier: 'second', userProductId: 'MLAU-SHARED' }),
    ]);

    expect(api.getWithMeta).toHaveBeenCalledTimes(1);
  });

  it('nunca supera 5 requests simult\u00e1neos', async () => {
    let activeRequests = 0;
    let maximumConcurrency = 0;
    const api = apiMock(async () => {
      activeRequests += 1;
      maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;
      return stockResponse([]);
    });
    const service = new StockBulkPreviewStockService(
      api as unknown as MercadolibreApiService,
    );

    await service.resolve(
      'access-token',
      Array.from({ length: 12 }, (_, index) => target(index)),
    );

    expect(maximumConcurrency).toBe(5);
  });
});

function apiMock(
  implementation: (
    path: string,
  ) =>
    | ReturnType<typeof stockResponse>
    | Promise<ReturnType<typeof stockResponse>>,
) {
  return {
    getWithMeta: jest.fn((path: string) =>
      Promise.resolve().then(() => implementation(path)),
    ),
  };
}

function stockResponse(locations: StockLocation[]) {
  return {
    data: { id: 'MLAU', user_id: 1, locations },
    headers: new Headers({ 'x-version': '1' }),
  };
}

function warehouse(storeId: string, nodeId: string): StockLocation {
  return {
    type: 'seller_warehouse',
    quantity: 1,
    store_id: storeId,
    network_node_id: nodeId,
  };
}

function target(
  index: number,
  overrides: Partial<StockBulkTarget> = {},
): StockBulkTarget {
  return {
    identifier: `MLAU-${index}`,
    title: `Producto ${index}`,
    color: null,
    size: '40',
    itemId: `MLA-${index}`,
    userProductId: `MLAU-${index}`,
    variationId: null,
    familyId: `FAMILY-${index}`,
    model: 'USER_PRODUCT',
    currentQuantity: 1,
    requestedQuantity: 2,
    currentStatus: 'active',
    needsChange: true,
    editable: true,
    ...overrides,
  };
}
