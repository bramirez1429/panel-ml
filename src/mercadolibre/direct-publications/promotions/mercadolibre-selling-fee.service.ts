import { Injectable } from '@nestjs/common';

import { PUBLICATION_REQUEST_CONCURRENCY } from '../../publications/publication.constants';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

export type SellingFeeResult = Readonly<{
  saleFeeAmount: number;
  estimatedNetAmount: number;
}>;

export type SellingFeeRequest = Readonly<{
  candidate: SellingFeeCandidate;
  effectivePrice: number;
}>;

export type SellingFeeCandidate = Readonly<{
  categoryId: string;
  catalogProductId?: string | null;
  domainId?: string | null;
  currencyId?: string | null;
  listingTypeId: string | null;
  shippingMode: string | null;
  logisticType: string | null;
  billableWeight?: number | null;
  campaignTag?: string | null;
  itemId?: string | null;
  freeShipping?: boolean | null;
  condition?: string | null;
}>;

@Injectable()
export class MercadoLibreSellingFeeService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  async getMany(
    requests: readonly SellingFeeRequest[],
    accessToken: string,
    sellerId?: number,
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
          batch.map((request) =>
            this.getOne(
              request,
              accessToken,
              sellerId,
            ),
          ),
        )),
      );
    }
    return results;
  }

  private async getOne(
    request: SellingFeeRequest,
    accessToken: string,
    sellerId?: number,
  ): Promise<SellingFeeResult | null> {
    const candidate = request.candidate;
    const effectivePrice = request.effectivePrice;
    const params = new URLSearchParams({
      price: String(effectivePrice),
    });

    if (candidate.catalogProductId) {
      params.set('catalog_product_id', candidate.catalogProductId);
    } else {
      params.set('category_id', candidate.categoryId);
    }

    addParam(params, 'domain_id', candidate.domainId ?? null);
    addParam(params, 'listing_type_id', candidate.listingTypeId);
    addParam(params, 'currency_id', candidate.currencyId ?? null);
    addParam(params, 'shipping_mode', candidate.shippingMode);
    addParam(params, 'logistic_type', candidate.logisticType);
    addNumberParam(
      params,
      'billable_weight',
      candidate.billableWeight ?? null,
    );
    addParam(
      params,
      'tags',
      candidate.campaignTag ?? null,
    );

    try {
      const response = await this.apiService.get<unknown>(
        `/sites/MLA/listing_prices?${params.toString()}`,
        accessToken,
      );
      const saleFeeAmount = findSaleFee(response);

      if (saleFeeAmount === null) {
        return null;
      }

      const shippingCostAmount =
        await this.getShippingCost(
          candidate,
          effectivePrice,
          sellerId,
          accessToken,
        );

      /*
       * Si el vendedor ofrece envío gratis y ML
       * no pudo cotizarlo, preferimos devolver
       * null antes que mostrar un "Recibís"
       * incorrectamente alto.
       */
      if (
        candidate.freeShipping === true &&
        shippingCostAmount === null
      ) {
        return null;
      }

      return {
        saleFeeAmount,
        estimatedNetAmount: roundMoney(
          effectivePrice -
            saleFeeAmount -
            (shippingCostAmount ?? 0),
        ),
      };
    } catch {
      return null;
    }
  }

  private async getShippingCost(
    candidate: SellingFeeCandidate,
    effectivePrice: number,
    sellerId: number | undefined,
    accessToken: string,
  ): Promise<number | null> {
    if (candidate.freeShipping !== true) {
      return 0;
    }

    if (
      !sellerId ||
      !candidate.itemId
    ) {
      return null;
    }

    const params = new URLSearchParams({
      item_id: candidate.itemId,
      verbose: 'true',
      item_price: String(effectivePrice),
      free_shipping: 'true',
    });

    addParam(
      params,
      'listing_type_id',
      candidate.listingTypeId,
    );

    addParam(
      params,
      'mode',
      candidate.shippingMode,
    );

    addParam(
      params,
      'logistic_type',
      candidate.logisticType,
    );

    addParam(
      params,
      'condition',
      candidate.condition ?? null,
    );

    try {
      const response =
        await this.apiService.get<unknown>(
          `/users/${sellerId}/shipping_options/free?${params.toString()}`,
          accessToken,
        );

      return findShippingCost(response);
    } catch {
      return null;
    }
  }
}

function findShippingCost(
  value: unknown,
): number | null {
  if (!isRecord(value)) return null;

  const coverage = value.coverage;
  if (!isRecord(coverage)) return null;

  const allCountry = coverage.all_country;
  if (!isRecord(allCountry)) return null;

  const amount = allCountry.list_cost;

  return typeof amount === 'number' &&
    Number.isFinite(amount) &&
    amount >= 0
    ? amount
    : null;
}

function roundMoney(
  value: number,
): number {
  return Math.round(value * 100) / 100;
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

function addNumberParam(
  params: URLSearchParams,
  key: string,
  value: number | null,
) {
  if (value !== null) params.set(key, String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
