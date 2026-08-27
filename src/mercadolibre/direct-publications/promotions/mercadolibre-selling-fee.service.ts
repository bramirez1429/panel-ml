import { Injectable } from '@nestjs/common';

import { PUBLICATION_REQUEST_CONCURRENCY } from '../../publications/publication.constants';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import type { PromotionCatalogCandidate } from './promotions-catalog.types';

export type SellingFeeResult = Readonly<{
  saleFeeAmount: number;
  estimatedNetAmount: number;
}>;

export type SellingFeeRequest = Readonly<{
  candidate: PromotionCatalogCandidate;
  effectivePrice: number;
}>;

@Injectable()
export class MercadoLibreSellingFeeService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  async getMany(
    requests: readonly SellingFeeRequest[],
    accessToken: string,
  ): Promise<Array<SellingFeeResult | null>> {
    const results: Array<SellingFeeResult | null> = [];
    for (
      let index = 0;
      index < requests.length;
      index += PUBLICATION_REQUEST_CONCURRENCY
    ) {
      const batch = requests.slice(
        index,
        index + PUBLICATION_REQUEST_CONCURRENCY,
      );
      results.push(
        ...(await Promise.all(
          batch.map((request) => this.getOne(request, accessToken)),
        )),
      );
    }
    return results;
  }

  private async getOne(
    request: SellingFeeRequest,
    accessToken: string,
  ): Promise<SellingFeeResult | null> {
    const candidate = request.candidate;
    const effectivePrice = request.effectivePrice;
    const params = new URLSearchParams({
      price: String(effectivePrice),
      category_id: candidate.categoryId,
    });
    addParam(params, 'listing_type_id', candidate.listingTypeId);
    addParam(params, 'shipping_mode', candidate.shippingMode);
    addParam(params, 'logistic_type', candidate.logisticType);
    try {
      const response = await this.apiService.get<unknown>(
        `/sites/MLA/listing_prices?${params.toString()}`,
        accessToken,
      );
      const saleFeeAmount = findSaleFee(response);
      return saleFeeAmount === null
        ? null
        : {
            saleFeeAmount,
            estimatedNetAmount: effectivePrice - saleFeeAmount,
          };
    } catch {
      return null;
    }
  }
}

function findSaleFee(value: unknown): number | null {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const amount = entry.sale_fee_amount;
    if (typeof amount === 'number' && Number.isFinite(amount)) return amount;
  }
  return null;
}

function addParam(params: URLSearchParams, key: string, value: string | null) {
  if (value) params.set(key, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
