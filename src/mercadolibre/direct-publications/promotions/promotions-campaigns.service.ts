import { BadRequestException, HttpException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../../publications/publication.constants';
import { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import type { PromotionCampaign } from './promotions-campaigns.types';
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
      const promotionPrice = promotionPriceOf(
        item,
        directedPromotions.get(item.id ?? '') ?? null,
      );
      return detail && promotionPrice !== null
        ? toSellingFeeRequest(detail, promotionPrice)
        : [];
    });
    const estimates = await this.sellingFeeService.getMany(
      feeRequests,
      accessToken,
    );
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
  const promotionPrice = rawPromotionPrice === 0 ? null : rawPromotionPrice;
  const totalDiscount = discountAmountOf(currentPrice, promotionPrice);
  const baseContribution =
    firstFinite(
      item.discount_meli_amount,
      directedPromotion?.discount_meli_amount,
    ) ??
    percentageAmount(
      totalDiscount,
      firstFinite(item.meli_percentage, directedPromotion?.meli_percentage),
    );
  const boost = firstFinite(
    item.discount_meli_boost_amount,
    directedPromotion?.discount_meli_boost_amount,
  );
  const contribution = contributionOf(baseContribution, boost);
  const sellerDiscount =
    percentageAmount(
      totalDiscount,
      firstFinite(item.seller_percentage, directedPromotion?.seller_percentage),
    ) ?? sellerDiscountOf(currentPrice, promotionPrice, contribution);
  return [
    {
      itemId,
      title: textOrNull(detail?.title),
      thumbnail: textOrNull(detail?.thumbnail),
      status,
      eligible: status === null ? null : status === 'candidate',
      currentPrice,
      promotionPrice,
      requiresPriceSelection:
        rawPromotionPrice === null ? null : rawPromotionPrice === 0,
      sellerDiscountAmount: sellerDiscount,
      mercadoLibreBaseContributionAmount: baseContribution,
      mercadoLibreBoostAmount: boost,
      mercadoLibreContributionAmount: contribution,
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
        listingTypeId: textOrNull(item.listing_type_id),
        shippingMode: textOrNull(item.shipping?.mode),
        logisticType: textOrNull(item.shipping?.logistic_type),
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

function contributionOf(
  baseContribution: number | null,
  boost: number | null,
): number | null {
  if (baseContribution === null && boost === null) return null;
  return (baseContribution ?? 0) + (boost ?? 0);
}

function discountAmountOf(
  currentPrice: number | null,
  promotionPrice: number | null,
): number | null {
  if (currentPrice === null || promotionPrice === null) return null;
  const discount = currentPrice - promotionPrice;
  return discount >= 0 ? discount : null;
}

function percentageAmount(
  amount: number | null,
  percentage: number | null,
): number | null {
  if (
    amount === null ||
    percentage === null ||
    percentage < 0 ||
    percentage > 100
  )
    return null;
  return Math.round(amount * percentage) / 100;
}

function sellerDiscountOf(
  currentPrice: number | null,
  promotionPrice: number | null,
  contribution: number | null,
): number | null {
  if (currentPrice === null || promotionPrice === null || contribution === null)
    return null;
  const amount = currentPrice - promotionPrice - contribution;
  return amount >= 0 ? amount : null;
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

function needsDirectedPromotionDetail(item: MlPromotionCampaignItem): boolean {
  return (
    textOrNull(item.status) === null ||
    finiteNumber(item.original_price) === null ||
    firstFinite(item.promotion_price, item.price) === null ||
    (finiteNumber(item.discount_meli_amount) === null &&
      finiteNumber(item.meli_percentage) === null) ||
    finiteNumber(item.discount_meli_boost_amount) === null ||
    finiteNumber(item.seller_percentage) === null
  );
}
