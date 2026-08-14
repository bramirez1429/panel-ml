import { ConflictException, Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import {
  publicationActionErrorMessage,
  PublicationActivityService,
} from '../activity/publication-activity.service';
import type { PublicationManagementContext } from '../mutations/publication-management-target.service';
import { PublicationManagementTargetService } from '../mutations/publication-management-target.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import {
  normalizePromotions,
  parsePriceDiscountInput,
  parsePromotionSelector,
} from './publication-promotions.helpers';
import {
  assertApplicablePriceDiscount,
  assertPriceDiscountTargetHints,
  hasRemovablePriceDiscount,
  isRemovablePriceDiscountStatus,
} from './publication-price-discount-policy';

const PROMOTIONS_PATH = '/seller-promotions/items/';

@Injectable()
export class PublicationPromotionsService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly sync: PublicationSyncService,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Consulta promociones vivas de cada MLA perteneciente al producto. */
  async get(productId: string, requestedItemId: unknown) {
    const contexts =
      requestedItemId === undefined
        ? await this.targets.resolveAll(productId)
        : [await this.targets.resolve(productId, requestedItemId)];
    const groups = await Promise.all(
      contexts.map(async (context) => {
        await this.targets.getOwnedItem(context);
        const rows = await this.read(context);
        return rows.map((promotion) => ({
          id: promotion.promotionId,
          type: promotion.type,
          status: promotion.status,
          name: promotion.name,
          itemId: context.target.itemId,
          variationId: null,
          userProductId: context.target.userProductId,
          regularPrice: promotion.originalPrice,
          promotionPrice: promotion.price,
          percentage: promotion.promotionPercentage,
          startDate: promotion.startDate,
          endDate: promotion.endDate,
          canApply:
            promotion.type === 'PRICE_DISCOUNT' &&
            promotion.status === 'candidate',
          canRemove:
            promotion.type === 'PRICE_DISCOUNT' &&
            isRemovablePriceDiscountStatus(promotion.status),
        }));
      }),
    );
    const promotions = groups.flat();
    return { productId, promotions };
  }

  /** Aplica PRICE_DISCOUNT sólo cuando ML informa un candidato elegible. */
  async applyPriceDiscount(productId: string, body: unknown) {
    const input = parsePriceDiscountInput(body);
    const context = await this.targets.resolve(productId, input.itemId);
    let oldValue: unknown = null;
    const payload = {
      deal_price: input.dealPrice,
      ...(input.topDealPrice === null
        ? {}
        : { top_deal_price: input.topDealPrice }),
      start_date: input.startDate,
      finish_date: input.finishDate,
      promotion_type: 'PRICE_DISCOUNT',
    };
    try {
      await this.targets.getOwnedItem(context);
      assertPriceDiscountTargetHints(context, input);
      const promotions = await this.read(context);
      oldValue = promotions;
      assertApplicablePriceDiscount(promotions, input.dealPrice);
      await this.apiService.post<unknown>(
        this.path(context.target.itemId),
        payload,
        context.accessToken,
        'promotionMutation',
      );
      await this.sync.syncItem(context.target.itemId, context.sellerId);
      await this.audit(
        context,
        productId,
        'PROMOTION_APPLIED',
        'SUCCESS',
        oldValue,
        payload,
      );
    } catch (error) {
      await this.audit(
        context,
        productId,
        'PROMOTION_APPLIED',
        'FAILED',
        oldValue,
        payload,
        error,
      );
      throw error;
    }
    return {
      ok: true as const,
      productId,
      itemId: context.target.itemId,
      type: 'PRICE_DISCOUNT' as const,
    };
  }

  /** Elimina exclusivamente un PRICE_DISCOUNT removible del MLA validado. */
  async removePriceDiscount(
    productId: string,
    body: unknown,
    queryItemId?: unknown,
  ) {
    const selector = parsePromotionSelector(body, queryItemId);
    const context = await this.targets.resolve(productId, selector.itemId);
    let oldValue: unknown = null;
    try {
      await this.targets.getOwnedItem(context);
      assertPriceDiscountTargetHints(context, selector);
      const promotions = await this.read(context);
      oldValue = promotions;
      if (!hasRemovablePriceDiscount(promotions)) {
        throw new ConflictException(
          'La publicación no tiene un PRICE_DISCOUNT removible',
        );
      }
      await this.apiService.delete<unknown>(
        `${PROMOTIONS_PATH}${encodeURIComponent(context.target.itemId)}?promotion_type=PRICE_DISCOUNT&app_version=v2`,
        context.accessToken,
        'promotionMutation',
      );
      await this.sync.syncItem(context.target.itemId, context.sellerId);
      await this.audit(
        context,
        productId,
        'PROMOTION_REMOVED',
        'SUCCESS',
        oldValue,
        null,
      );
    } catch (error) {
      await this.audit(
        context,
        productId,
        'PROMOTION_REMOVED',
        'FAILED',
        oldValue,
        null,
        error,
      );
      throw error;
    }
    return {
      ok: true as const,
      productId,
      itemId: context.target.itemId,
      type: 'PRICE_DISCOUNT' as const,
    };
  }

  private async read(context: PublicationManagementContext) {
    const response = await this.apiService.getOptional<unknown>(
      this.path(context.target.itemId),
      context.accessToken,
    );
    if (response === null) return [];
    return normalizePromotions(response);
  }

  private path(itemId: string): string {
    return `${PROMOTIONS_PATH}${encodeURIComponent(itemId)}?app_version=v2`;
  }

  private audit(
    context: PublicationManagementContext,
    productId: string,
    action: 'PROMOTION_APPLIED' | 'PROMOTION_REMOVED',
    status: 'SUCCESS' | 'FAILED',
    oldValue: unknown,
    newValue: unknown,
    error?: unknown,
  ) {
    return this.activity.recordBestEffort({
      sellerId: context.sellerId,
      productId,
      itemId: context.target.itemId,
      action,
      status,
      oldValue,
      newValue,
      errorMessage:
        error === undefined ? null : publicationActionErrorMessage(error),
    });
  }
}
