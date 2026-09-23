import { Injectable } from '@nestjs/common';

import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type {
  StockLocation,
  UserProductStockResponse,
} from '../stock/stock.types';
import type { StockBulkTarget } from './stock-bulk.types';

const PREVIEW_STOCK_CONCURRENCY = 5;

type PreviewUserProductStock = Readonly<{
  locations: readonly StockLocation[];
  xVersion: string | null;
}>;

@Injectable()
export class StockBulkPreviewStockService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  resolve(
    accessToken: string,
    targets: readonly StockBulkTarget[],
  ): Promise<StockBulkTarget[]> {
    const cache = new Map<string, Promise<PreviewUserProductStock>>();
    return mapWithConcurrency(targets, PREVIEW_STOCK_CONCURRENCY, (target) =>
      this.resolveTarget(accessToken, target, cache),
    );
  }

  private async resolveTarget(
    accessToken: string,
    target: StockBulkTarget,
    cache: Map<string, Promise<PreviewUserProductStock>>,
  ): Promise<StockBulkTarget> {
    if (target.model === 'LEGACY' || !target.editable) return target;
    if (!target.userProductId) {
      return notEditable(target, target.currentQuantity, 'STOCK_UNAVAILABLE');
    }

    try {
      const stock = await this.getStock(
        accessToken,
        target.userProductId,
        cache,
      );
      const currentQuantity = stock.locations.length
        ? stock.locations.reduce(
            (total, location) => total + quantity(location.quantity),
            0,
          )
        : target.currentQuantity;
      const warehouses = stock.locations.filter(
        (location) => location.type === 'seller_warehouse',
      );
      if (warehouses.length > 1) {
        return notEditable(target, currentQuantity, 'MULTIPLE_STOCK_LOCATIONS');
      }

      const warehouse = warehouses[0];
      if (warehouse && (!warehouse.store_id || !warehouse.network_node_id)) {
        return notEditable(
          target,
          currentQuantity,
          'STOCK_LOCATION_INCOMPLETE',
        );
      }

      return {
        ...target,
        currentQuantity,
        needsChange: currentQuantity !== target.requestedQuantity,
        ...(warehouse
          ? {
              storeId: warehouse.store_id,
              networkNodeId: warehouse.network_node_id,
            }
          : {}),
      };
    } catch {
      return notEditable(target, target.currentQuantity, 'STOCK_UNAVAILABLE');
    }
  }

  private getStock(
    accessToken: string,
    userProductId: string,
    cache: Map<string, Promise<PreviewUserProductStock>>,
  ): Promise<PreviewUserProductStock> {
    const cached = cache.get(userProductId);
    if (cached) return cached;

    const pending = this.apiService
      .getWithMeta<UserProductStockResponse>(
        `/user-products/${encodeURIComponent(userProductId)}/stock`,
        accessToken,
      )
      .then(({ data, headers }) => ({
        locations: data.locations ?? [],
        xVersion: headers.get('x-version'),
      }));
    cache.set(userProductId, pending);
    return pending;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  handler: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await handler(items[index]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function quantity(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function notEditable(
  target: StockBulkTarget,
  currentQuantity: number,
  reason: string,
): StockBulkTarget {
  return {
    ...target,
    currentQuantity,
    needsChange: currentQuantity !== target.requestedQuantity,
    editable: false,
    reason,
  };
}
