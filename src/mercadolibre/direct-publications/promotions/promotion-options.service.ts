import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { ItemsService } from '../items/items.service';

import {
  normalizePromotion,
  toPromotionCandidate,
} from './promotions-catalog.helpers';
import type { PromotionOption } from './promotions-catalog.types';
import {
  MercadoLibreSellingFeeService,
  type SellingFeeRequest,
  type SellingFeeResult,
} from './mercadolibre-selling-fee.service';
import {
  normalizePromotionFinancialPreview,
  type PromotionFinancialPreview,
} from './promotion-financial-preview';
import { promotionError } from './promotion-errors';
import { PromotionsService } from './promotions.service';

const SUPPORTED_TYPES = new Set([
  'PRICE_DISCOUNT',
  'DEAL',
  'SELLER_CAMPAIGN',
  'SMART',
]);

@Injectable()
export class PromotionOptionsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly itemsService: ItemsService,
    private readonly promotionsService: PromotionsService,
    private readonly sellingFeeService: MercadoLibreSellingFeeService,
  ) {}

  async getOptions(userId: string, itemId: string): Promise<PromotionOption[]> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const item = await this.itemsService.getOne(itemId, accessToken);
    const candidate = toPromotionCandidate(item);
    if (!candidate) {
      throw promotionError(
        'PROMOTION_NOT_FOUND',
        'No se encontró una publicación promocionable',
      );
    }
    const promotions = await this.promotionsService.getPromotions(
      userId,
      itemId,
      accessToken,
    );
    const promotionsByStatus = [
      ...promotions.active.map((promotion) => ({
        promotion,
        status: 'started' as const,
      })),
      ...promotions.candidates.map((promotion) => ({
        promotion,
        status: 'candidate' as const,
      })),
      ...promotions.pending.map((promotion) => ({
        promotion,
        status: 'pending' as const,
      })),
    ];
    const prepared = promotionsByStatus.map(({ promotion, status }) => {
      const normalized = normalizePromotion(promotion);
      const financial = normalizePromotionFinancialPreview({
        promotionType: normalized.type,
        currentPrice: normalized.originalPrice ?? candidate.price,
        rawPromotionPrice: finiteNumber(promotion.price),
        minPromotionPrice: finiteNumber(promotion.min_discounted_price),
        maxPromotionPrice: finiteNumber(promotion.max_discounted_price),
        suggestedPromotionPrice: finiteNumber(
          promotion.suggested_discounted_price,
        ),
        meliPercentage: finiteNumber(promotion.meli_percentage),
        sellerPercentage: finiteNumber(promotion.seller_percentage),
        discountMeliAmount: finiteNumber(promotion.discount_meli_amount),
        discountMeliBoostAmount: finiteNumber(
          promotion.discount_meli_boost_amount,
        ),
        deferFinancialsWhenPriceSelectionRequired: status === 'candidate',
      });
      return { promotion, status, normalized, financial };
    });
    const requestEntries = prepared.flatMap((entry, index) => {
      const effectivePrice = entry.financial.effectiveCalculationPrice;
      return effectivePrice !== null
        ? [{ index, request: { candidate, effectivePrice } }]
        : [];
    });
    const requests: SellingFeeRequest[] = requestEntries.map(
      ({ request }) => request,
    );
    const estimates = requests.length
      ? await this.sellingFeeService.getMany(requests, accessToken)
      : [];
    const estimateByIndex = new Map<number, SellingFeeResult | null>(
      requestEntries.map(({ index }, estimateIndex) => [
        index,
        estimates[estimateIndex] ?? null,
      ]),
    );
    return prepared.map((entry, index) => {
      const estimate = estimateByIndex.get(index) ?? null;
      return toPromotionOption(entry, estimate);
    });
  }
}

function toPromotionOption(
  entry: Readonly<{
    promotion: Readonly<{ type?: string }>;
    status: 'started' | 'candidate' | 'pending';
    normalized: ReturnType<typeof normalizePromotion>;
    financial: PromotionFinancialPreview;
  }>,
  estimate: SellingFeeResult | null,
): PromotionOption {
  return {
    ...entry.normalized,
    status: entry.status,
    promotionPrice: entry.financial.promotionPrice,
    minPromotionPrice: entry.financial.minPromotionPrice,
    maxPromotionPrice: entry.financial.maxPromotionPrice,
    suggestedPromotionPrice: entry.financial.suggestedPromotionPrice,
    requiresPriceSelection: entry.financial.requiresPriceSelection,
    sellerDiscountAmount: entry.financial.sellerDiscountAmount,
    mercadoLibreBaseContributionAmount:
      entry.financial.mercadoLibreBaseContributionAmount,
    mercadoLibreBoostAmount: entry.financial.mercadoLibreBoostAmount,
    mercadoLibreContributionAmount:
      entry.financial.mercadoLibreContributionAmount,
    estimatedNetAmount: estimate?.estimatedNetAmount ?? null,
    canApply:
      entry.status === 'candidate' &&
      SUPPORTED_TYPES.has(entry.promotion.type?.toUpperCase() ?? ''),
    canRemove: entry.status === 'started',
    saleEstimate: estimate,
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
