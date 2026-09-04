import { BadRequestException, HttpException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../../publications/publication.constants';
import { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import type { PromotionCampaign } from './promotions-campaigns.types';
import { normalizePromotionFinancialPreview } from './promotion-financial-preview';
import {
  financingCampaignTagOf,
  promotionCampaignItemCommerceOf,
} from './promotion-campaign-item-commerce';
import type {
  PromotionDiagnostic,
  PromotionDiagnosticEntry,
} from './promotion-diagnostic.types';
import type {
  PromotionCampaignItem,
  PromotionCampaignItemsPaging,
  PromotionCampaignItemsQuery,
} from './promotions-campaign-items.types';
import {
  MercadoLibreSellingFeeService,
  type SellingFeeRequest,
} from './mercadolibre-selling-fee.service';
import { PromotionsService } from './promotions.service';
import type {
  MlPromotion,
  MlPromotionCampaignItem,
  MlPromotionCampaignItemsResponse,
} from './promotions.types';

@Injectable()
export class PromotionsCampaignsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly promotionsService: PromotionsService,
    private readonly itemsService: ItemsService,
    private readonly sellingFeeService: MercadoLibreSellingFeeService,
  ) {}

  async getCampaigns(userId: string) {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    return {
      campaigns: (
        await this.promotionsService.getSellerCampaigns(
          userId,
          connection.seller_id,
          accessToken,
        )
      )
        .map(toCampaign)
        .filter((campaign): campaign is PromotionCampaign => campaign !== null),
    };
  }

  async getPromotionDiagnostic(
    userId: string,
    itemId: string,
  ): Promise<PromotionDiagnostic> {
    const id = requiredText(itemId, 'itemId es obligatorio');
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const promotions = await this.promotionsService.getPromotionsStrict(
      userId,
      id,
      accessToken,
    );
    return {
      itemId: id,
      promotions: promotions.all.map(toPromotionDiagnosticEntry),
    };
  }

  async getCampaignItems(
    userId: string,
    promotionId: string,
    query: PromotionCampaignItemsQuery,
  ) {
    const id = requiredText(promotionId, 'promotionId es obligatorio');
    const promotionType = requiredText(
      query.promotionType,
      'promotionType es obligatorio',
    );
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const response = await this.promotionsService.getCampaignItems(
      userId,
      id,
      promotionType,
      accessToken,
      { limit: query.limit, offset: query.offset },
    );
    const directedPromotions = await this.getDirectedPromotionDetails(
      userId,
      id,
      promotionType,
      response.results,
      accessToken,
    );
    const details = await this.itemsService.getMany(
      response.results.flatMap((item) => {
        const itemId = textOrNull(item.id);
        return itemId ? [itemId] : [];
      }),
      accessToken,
    );
    const detailsById = new Map(details.map((item) => [item.id, item]));
    const feeRequests = response.results.flatMap((item) => {
      const detail = detailsById.get(item.id ?? '');
      const effectiveCalculationPrice = effectiveCalculationPriceOf(
        item,
        directedPromotions.get(item.id ?? '') ?? null,
        promotionType,
      );
      return detail && effectiveCalculationPrice !== null
        ? toSellingFeeRequest(detail, effectiveCalculationPrice)
        : [];
    });
    const estimates = feeRequests.length
      ? await this.sellingFeeService.getMany(feeRequests, accessToken)
      : [];
    const estimateByItemId = new Map(
      feeRequests.map((request, index) => [
        request.itemId,
        estimates[index] ?? null,
      ]),
    );
    const paging = normalizePaging(response.paging);
    return {
      items: response.results.flatMap((item) =>
        toCampaignItem(
          item,
          promotionType,
          directedPromotions.get(item.id ?? '') ?? null,
          detailsById.get(item.id ?? '') ?? null,
          estimateByItemId.get(item.id ?? '') ?? null,
        ),
      ),
      ...(paging ? { paging } : {}),
    };
  }

  private async getDirectedPromotionDetails(
    userId: string,
    promotionId: string,
    promotionType: string,
    items: readonly MlPromotionCampaignItem[],
    accessToken: string,
  ): Promise<Map<string, MlPromotion>> {
    const itemIds = [
      ...new Set(
        items.flatMap((item) => {
          const itemId = textOrNull(item.id);
          return itemId && needsDirectedPromotionDetail(item) ? [itemId] : [];
        }),
      ),
    ];
    const details = new Map<string, MlPromotion>();
    for (
      let index = 0;
      index < itemIds.length;
      index += PUBLICATION_REQUEST_CONCURRENCY
    ) {
      const batch = itemIds.slice(
        index,
        index + PUBLICATION_REQUEST_CONCURRENCY,
      );
      const promotions = await Promise.all(
        batch.map((itemId) =>
          this.getDirectedPromotion(
            userId,
            itemId,
            promotionId,
            promotionType,
            accessToken,
          ),
        ),
      );
      batch.forEach((itemId, batchIndex) => {
        const promotion = promotions[batchIndex];
        if (promotion) details.set(itemId, promotion);
      });
    }
    return details;
  }

  private async getDirectedPromotion(
    userId: string,
    itemId: string,
    promotionId: string,
    promotionType: string,
    accessToken: string,
  ): Promise<MlPromotion | null> {
    try {
      const promotions = await this.promotionsService.getPromotionsStrict(
        userId,
        itemId,
        accessToken,
      );
      return (
        promotions.all.find(
          (promotion) =>
            textOrNull(promotion.id) === promotionId &&
            textOrNull(promotion.type) === promotionType,
        ) ?? null
      );
    } catch (error) {
      if (
        error instanceof HttpException &&
        (error.getStatus() === 401 || error.getStatus() === 403)
      )
        throw error;
      return null;
    }
  }
}

function toPromotionDiagnosticEntry(
  promotion: MlPromotion,
): PromotionDiagnosticEntry {
  return {
    id: textOrNull(promotion.id),
    type: textOrNull(promotion.type),
    status: textOrNull(promotion.status),
    originalPrice: finiteNumber(promotion.original_price),
    price: finiteNumber(promotion.price),
    minDiscountedPrice: finiteNumber(promotion.min_discounted_price),
    maxDiscountedPrice: finiteNumber(promotion.max_discounted_price),
    suggestedDiscountedPrice: finiteNumber(
      promotion.suggested_discounted_price,
    ),
    meliPercentage: finiteNumber(promotion.meli_percentage),
    sellerPercentage: finiteNumber(promotion.seller_percentage),
    discountMeliAmount: finiteNumber(promotion.discount_meli_amount),
    discountMeliBoostAmount: finiteNumber(promotion.discount_meli_boost_amount),
    offerId: firstText(promotion.ref_id, promotion.offer_id),
  };
}

function toCampaign(promotion: MlPromotion): PromotionCampaign | null {
  const id = textOrNull(promotion.id);
  const type = textOrNull(promotion.type);
  const status = textOrNull(promotion.status);
  if (!id || !type || (status !== 'started' && status !== 'pending'))
    return null;
  return {
    id,
    name: textOrNull(promotion.name),
    type,
    status,
    startDate: textOrNull(promotion.start_date),
    finishDate: textOrNull(promotion.finish_date),
    deadlineDate: textOrNull(promotion.deadline_date),
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredText(value: unknown, message: string): string {
  const text = textOrNull(value);
  if (!text) throw new BadRequestException(message);
  return text;
}

function toCampaignItem(
  item: MlPromotionCampaignItem,
  promotionType: string,
  directedPromotion: MlPromotion | null,
  detail: MlItem | null,
  estimate: Readonly<{ estimatedNetAmount: number }> | null,
): PromotionCampaignItem[] {
  const itemId = textOrNull(item.id);
  if (!itemId) return [];
  const status = firstText(item.status, directedPromotion?.status);
  const currentPrice =
    firstFinite(item.original_price, directedPromotion?.original_price) ??
    priceOf(detail);
  const rawPromotionPrice = rawPromotionPriceOf(item, directedPromotion);
  const financialPreview = normalizePromotionFinancialPreview({
    promotionType,
    currentPrice,
    rawPromotionPrice,
    minPromotionPrice: guidancePriceOf(
      item,
      directedPromotion,
      'min_discounted_price',
    ),
    maxPromotionPrice: guidancePriceOf(
      item,
      directedPromotion,
      'max_discounted_price',
    ),
    suggestedPromotionPrice: guidancePriceOf(
      item,
      directedPromotion,
      'suggested_discounted_price',
    ),
    meliPercentage: firstFinite(
      item.meli_percentage,
      directedPromotion?.meli_percentage,
    ),
    sellerPercentage: firstFinite(
      item.seller_percentage,
      directedPromotion?.seller_percentage,
    ),
    discountMeliAmount: firstFinite(
      item.discount_meli_amount,
      directedPromotion?.discount_meli_amount,
    ),
    discountMeliBoostAmount: firstFinite(
      item.discount_meli_boost_amount,
      directedPromotion?.discount_meli_boost_amount,
    ),
    deferFinancialsWhenPriceSelectionRequired: promotionType === 'DEAL',
  });
  return [
    {
      itemId,
      title: textOrNull(detail?.title),
      thumbnail: textOrNull(detail?.thumbnail),
      ...promotionCampaignItemCommerceOf(detail),
      status,
      eligible: status === null ? null : status === 'candidate',
      currentPrice,
      promotionPrice: financialPreview.promotionPrice,
      minPromotionPrice: financialPreview.minPromotionPrice,
      maxPromotionPrice: financialPreview.maxPromotionPrice,
      suggestedPromotionPrice: financialPreview.suggestedPromotionPrice,
      requiresPriceSelection: financialPreview.requiresPriceSelection,
      sellerDiscountAmount: financialPreview.sellerDiscountAmount,
      mercadoLibreBaseContributionAmount:
        financialPreview.mercadoLibreBaseContributionAmount,
      mercadoLibreBoostAmount: financialPreview.mercadoLibreBoostAmount,
      mercadoLibreContributionAmount:
        financialPreview.mercadoLibreContributionAmount,
      estimatedNetAmount: estimate?.estimatedNetAmount ?? null,
    },
  ];
}

function toSellingFeeRequest(
  item: MlItem,
  effectivePrice: number,
): Array<SellingFeeRequest & { itemId: string }> {
  const itemId = textOrNull(item.id);
  const categoryId = textOrNull(item.category_id);
  if (!itemId || !categoryId || effectivePrice <= 0) return [];
  return [
    {
      itemId,
      effectivePrice,
      candidate: {
        categoryId,
        currencyId: textOrNull(item.currency_id),
        listingTypeId: textOrNull(item.listing_type_id),
        shippingMode: textOrNull(item.shipping?.mode),
        logisticType: textOrNull(item.shipping?.logistic_type),
        billableWeight: billableWeightOf(item),
        campaignTag:
          financingCampaignTagOf(item),
      },
    },
  ];
}

function promotionPriceOf(
  item: MlPromotionCampaignItem,
  directedPromotion: MlPromotion | null,
): number | null {
  const price = rawPromotionPriceOf(item, directedPromotion);
  return price === 0 ? null : price;
}

function effectiveCalculationPriceOf(
  item: MlPromotionCampaignItem,
  directedPromotion: MlPromotion | null,
  promotionType: string,
): number | null {
  const rawPromotionPrice = rawPromotionPriceOf(item, directedPromotion);
  if (shouldDeferDealFinancials(promotionType, rawPromotionPrice === 0))
    return null;
  return selectEffectiveCalculationPrice(
    promotionType,
    promotionPriceOf(item, directedPromotion),
    guidancePriceOf(item, directedPromotion, 'max_discounted_price'),
    guidancePriceOf(item, directedPromotion, 'suggested_discounted_price'),
  );
}

function shouldDeferDealFinancials(
  promotionType: string,
  requiresPriceSelection: boolean | null,
): boolean {
  return promotionType === 'DEAL' && requiresPriceSelection === true;
}

function selectEffectiveCalculationPrice(
  promotionType: string,
  promotionPrice: number | null,
  maxPromotionPrice: number | null,
  suggestedPromotionPrice: number | null,
): number | null {
  return promotionType === 'DEAL'
    ? (promotionPrice ?? maxPromotionPrice ?? suggestedPromotionPrice)
    : (promotionPrice ?? suggestedPromotionPrice);
}

function rawPromotionPriceOf(
  item: MlPromotionCampaignItem,
  directedPromotion: MlPromotion | null,
): number | null {
  return firstFinite(
    item.promotion_price,
    item.price,
    directedPromotion?.price,
  );
}

function priceOf(item: MlItem | null): number | null {
  return finiteNumber(item?.original_price) ?? finiteNumber(item?.price);
}

type MlItemWithBillableWeight = MlItem & {
  billable_weight?: unknown;
  shipping?: MlItem['shipping'] & { billable_weight?: unknown };
};

function billableWeightOf(item: MlItem): number | null {
  const weightedItem = item as MlItemWithBillableWeight;
  return (
    positiveFiniteNumber(weightedItem.billable_weight) ??
    positiveFiniteNumber(weightedItem.shipping?.billable_weight)
  );
}

function normalizePaging(
  paging: MlPromotionCampaignItemsResponse['paging'],
): PromotionCampaignItemsPaging | null {
  const total = finiteNumber(paging?.total);
  const offset = finiteNumber(paging?.offset);
  const limit = finiteNumber(paging?.limit);
  if (
    total === null ||
    offset === null ||
    limit === null ||
    total < 0 ||
    offset < 0 ||
    limit < 1
  )
    return null;
  return { total, offset, limit };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = textOrNull(value);
    if (text !== null) return text;
  }
  return null;
}

type PriceGuidanceField =
  | 'min_discounted_price'
  | 'max_discounted_price'
  | 'suggested_discounted_price';

const PRICE_GUIDANCE_FIELDS: readonly PriceGuidanceField[] = [
  'min_discounted_price',
  'max_discounted_price',
  'suggested_discounted_price',
];

function guidancePriceOf(
  item: MlPromotionCampaignItem,
  directedPromotion: MlPromotion | null,
  field: PriceGuidanceField,
): number | null {
  if (hasOwn(item, field)) return finiteNumber(item[field]);
  return finiteNumber(directedPromotion?.[field]);
}

function hasOwn(value: object, field: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function needsDirectedPromotionDetail(item: MlPromotionCampaignItem): boolean {
  return (
    textOrNull(item.status) === null ||
    finiteNumber(item.original_price) === null ||
    firstFinite(item.promotion_price, item.price) === null ||
    PRICE_GUIDANCE_FIELDS.some((field) => !hasOwn(item, field)) ||
    (finiteNumber(item.discount_meli_amount) === null &&
      finiteNumber(item.meli_percentage) === null) ||
    finiteNumber(item.discount_meli_boost_amount) === null ||
    finiteNumber(item.seller_percentage) === null
  );
}
