import { Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../mercadolibre/auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../mercadolibre/shared/mercadolibre-api.service';
import { MercadolibreSaleIngestionService } from './mercadolibre-sale-ingestion.service';

const PAGE_SIZE = 50;
const PROCESS_CONCURRENCY = 4;
const MAX_ORDERS = 500;

type BackfillResult = Readonly<{
  found: number;
  processed: number;
  failed: number;
}>;

@Injectable()
export class MercadolibreSalesBackfillService {
  constructor(
    private readonly tokens: MercadolibreTokenService,
    private readonly api: MercadolibreApiService,
    private readonly ingestion: MercadolibreSaleIngestionService,
  ) {}

  async sync(userId: string, hours: number): Promise<BackfillResult> {
    const connection = await this.tokens.getStoredConnection(userId);
    const accessToken = await this.tokens.getValidAccessToken(
      userId,
      connection,
    );

    const orderIds = await this.findOrderIds(
      connection.seller_id,
      accessToken,
      hours,
    );

    let processed = 0;
    let failed = 0;

    for (let index = 0; index < orderIds.length; index += PROCESS_CONCURRENCY) {
      const batch = orderIds.slice(index, index + PROCESS_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map((orderId) =>
          this.ingestion.process(orderId, connection.seller_id),
        ),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') processed += 1;
        else failed += 1;
      }
    }

    return {
      found: orderIds.length,
      processed,
      failed,
    };
  }

  private async findOrderIds(
    sellerId: number,
    accessToken: string,
    hours: number,
  ): Promise<string[]> {
    const to = new Date();
    const from = new Date(to.getTime() - hours * 60 * 60 * 1000);

    const ids: string[] = [];
    let offset = 0;

    while (ids.length < MAX_ORDERS) {
      const params = new URLSearchParams({
        seller: String(sellerId),
        'order.status': 'paid',
        'order.date_created.from': from.toISOString(),
        'order.date_created.to': to.toISOString(),
        sort: 'date_desc',
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      const page = await this.api.get<unknown>(
        `/orders/search?${params.toString()}`,
        accessToken,
      );

      const result = parseSearchPage(page);
      ids.push(...result.ids);

      if (
        result.ids.length < PAGE_SIZE ||
        offset + PAGE_SIZE >= result.total
      ) {
        break;
      }

      offset += PAGE_SIZE;
    }

    return ids.slice(0, MAX_ORDERS);
  }
}

function parseSearchPage(value: unknown): {
  ids: string[];
  total: number;
} {
  if (!isRecord(value)) return { ids: [], total: 0 };

  const results = Array.isArray(value.results)
    ? value.results
    : [];

  const ids = results.flatMap((order) => {
    if (!isRecord(order)) return [];

    const id = order.id;

    if (
      (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
      (typeof id === 'string' && /^[1-9]\d*$/.test(id))
    ) {
      return [String(id)];
    }

    return [];
  });

  const paging = isRecord(value.paging) ? value.paging : null;
  const total =
    typeof paging?.total === 'number' &&
    Number.isSafeInteger(paging.total) &&
    paging.total >= 0
      ? paging.total
      : ids.length;

  return { ids, total };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

