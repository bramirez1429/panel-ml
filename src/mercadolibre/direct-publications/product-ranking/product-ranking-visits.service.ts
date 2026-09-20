import { HttpException, Injectable } from '@nestjs/common';

import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

export const PRODUCT_RANKING_VISITS_BATCH_SIZE = 20;

type VisitsValue = number | null;
type VisitsResponseItem = {
  item_id?: unknown;
  total_visits?: unknown;
};

@Injectable()
export class ProductRankingVisitsService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  async getVisits(
    itemIds: readonly string[],
    accessToken: string,
    days: number,
    now = new Date(),
  ): Promise<Map<string, VisitsValue>> {
    const uniqueItemIds = [...new Set(itemIds.filter(Boolean))];
    const visits = new Map<string, VisitsValue>();
    const { dateFrom, dateTo } = visitsRange(now, days);

    for (
      let index = 0;
      index < uniqueItemIds.length;
      index += PRODUCT_RANKING_VISITS_BATCH_SIZE
    ) {
      const batch = uniqueItemIds.slice(
        index,
        index + PRODUCT_RANKING_VISITS_BATCH_SIZE,
      );
      try {
        const response = await this.apiService.get<
          VisitsResponseItem | VisitsResponseItem[]
        >(
          visitsPath(batch, dateFrom, dateTo),
          accessToken,
        );
        const results = Array.isArray(response) ? response : [response];
        for (const itemId of batch) visits.set(itemId, null);
        for (const result of results) {
          if (
            typeof result.item_id === 'string' &&
            batch.includes(result.item_id) &&
            typeof result.total_visits === 'number' &&
            Number.isFinite(result.total_visits) &&
            result.total_visits >= 0
          ) {
            visits.set(result.item_id, Math.trunc(result.total_visits));
          }
        }
      } catch (error) {
        if (isAuthenticationError(error)) throw error;
        for (const itemId of batch) visits.set(itemId, null);
      }
    }

    return visits;
  }
}

function visitsRange(now: Date, days: number): { dateFrom: string; dateTo: string } {
  const dateTo = new Date(now.getTime());
  const dateFrom = new Date(
    dateTo.getTime() - days * 24 * 60 * 60 * 1000,
  );
  return { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() };
}

function visitsPath(
  itemIds: readonly string[],
  dateFrom: string,
  dateTo: string,
): string {
  const params = new URLSearchParams({
    ids: itemIds.join(','),
    date_from: dateFrom,
    date_to: dateTo,
  });
  return `/items/visits?${params.toString()}`;
}

function isAuthenticationError(error: unknown): boolean {
  return (
    error instanceof HttpException &&
    (error.getStatus() === 401 || error.getStatus() === 403)
  );
}
