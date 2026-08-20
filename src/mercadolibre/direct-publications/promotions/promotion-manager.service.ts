import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { PublicationDetailService } from '../publications/publication-detail.service';

import { DealService } from './deal.service';
import { PriceDiscountService } from './price-discount.service';
import { SellerCampaignService } from './seller-campaign.service';
import { SmartPromotionService } from './smart-promotion.service';

import type {
  ManagedActivePromotion,
  ManagedPromotionType,
  PromotionManagerResult,
  PromotionSwitchRequest,
} from './promotion-manager.types';

type PublicationKind =
  | {
      type: 'CLASSIC';
      itemId: string;
    }
  | {
      type: 'NEW';
      familyId: string;
      itemId: string;
    };

@Injectable()
export class PromotionManagerService {
  constructor(
    private readonly publicationDetailService:
      PublicationDetailService,

    private readonly priceDiscountService:
      PriceDiscountService,

    private readonly dealService:
      DealService,

    private readonly sellerCampaignService:
      SellerCampaignService,

    private readonly smartPromotionService:
      SmartPromotionService,
  ) {}

  async switchClassic(
    itemId: string,
    request: PromotionSwitchRequest,
  ): Promise<PromotionManagerResult> {
    return this.switchPromotion(
      {
        type: 'CLASSIC',
        itemId,
      },
      request,
    );
  }

  async switchNew(
    familyId: string,
    itemId: string,
    request: PromotionSwitchRequest,
  ): Promise<PromotionManagerResult> {
    return this.switchPromotion(
      {
        type: 'NEW',
        familyId,
        itemId,
      },
      request,
    );
  }

  private async switchPromotion(
    publication: PublicationKind,
    request: PromotionSwitchRequest,
  ): Promise<PromotionManagerResult> {
    const before =
      await this.publicationDetailService.getDetail(
        publication.itemId,
      );

    const previousPromotion =
      this.getFirstActivePromotion(
        before.promotions?.active,
      );

    let removedPreviousPromotion = false;

    if (previousPromotion) {
      await this.removePromotion(
        publication,
        previousPromotion,
      );

      removedPreviousPromotion = true;

      await this.waitForNoActivePromotion(
        publication.itemId,
      );
    }

    await this.waitForCandidate(
      publication.itemId,
      request,
    );

    await this.activatePromotionWithRetry(
      publication,
      request,
    );

    const activePromotion =
      await this.waitForPromotion(
        publication.itemId,
        request.type,
      );

    const verified =
      activePromotion?.type ===
      request.type;

    return {
      success: verified,

      previousPromotion,

      removedPreviousPromotion,

      requestedPromotion:
        request.type,

      activePromotion,

      verified,
    };
  }

  private async activatePromotionWithRetry(
    publication: PublicationKind,
    request: PromotionSwitchRequest,
  ): Promise<void> {
    let lastError: unknown = null;

    for (
      let attempt = 0;
      attempt < 10;
      attempt++
    ) {
      try {
        await this.activatePromotion(
          publication,
          request,
        );

        return;
      } catch (error) {
        lastError = error;

        if (
          !this.isNoCandidatesError(
            error,
          )
        ) {
          throw error;
        }

        await this.delay(1000);
      }
    }

    throw lastError;
  }

  private isNoCandidatesError(
    error: unknown,
  ): boolean {
    const httpError =
      error as {
        message?: unknown;
        response?: unknown;
        getResponse?: () => unknown;
      };

    let response:
      | unknown
      | undefined;

    try {
      response =
        typeof httpError?.getResponse ===
        'function'
          ? httpError.getResponse()
          : httpError?.response;
    } catch {
      response = undefined;
    }

    const content =
      JSON.stringify(
        response ??
          httpError?.message ??
          error,
      ).toLowerCase();

    return content.includes(
      'no candidates found',
    );
  }

  private async activatePromotion(
    publication: PublicationKind,
    request: PromotionSwitchRequest,
  ): Promise<void> {
    switch (request.type) {
      case 'PRICE_DISCOUNT': {
        const changes = {
          dealPrice:
            request.dealPrice,

          topDealPrice:
            request.topDealPrice,

          startDate:
            request.startDate,

          finishDate:
            request.finishDate,
        };

        if (
          publication.type ===
          'CLASSIC'
        ) {
          await this.priceDiscountService.createClassicPriceDiscount(
            publication.itemId,
            changes,
          );

          return;
        }

        await this.priceDiscountService.createNewPriceDiscount(
          publication.familyId,
          publication.itemId,
          changes,
        );

        return;
      }

      case 'DEAL': {
        const changes = {
          promotionId:
            request.promotionId,

          dealPrice:
            request.dealPrice,

          topDealPrice:
            request.topDealPrice,
        };

        if (
          publication.type ===
          'CLASSIC'
        ) {
          await this.dealService.createClassic(
            publication.itemId,
            changes,
          );

          return;
        }

        await this.dealService.createNew(
          publication.familyId,
          publication.itemId,
          changes,
        );

        return;
      }

      case 'SELLER_CAMPAIGN': {
        const changes = {
          promotionId:
            request.promotionId,

          dealPrice:
            request.dealPrice,
        };

        if (
          publication.type ===
          'CLASSIC'
        ) {
          await this.sellerCampaignService.createClassic(
            publication.itemId,
            changes,
          );

          return;
        }

        await this.sellerCampaignService.createNew(
          publication.familyId,
          publication.itemId,
          changes,
        );

        return;
      }

      case 'SMART': {
        const changes = {
          promotionId:
            request.promotionId,

          offerId:
            request.offerId,
        };

        if (
          publication.type ===
          'CLASSIC'
        ) {
          await this.smartPromotionService.createClassic(
            publication.itemId,
            changes,
          );

          return;
        }

        await this.smartPromotionService.createNew(
          publication.familyId,
          publication.itemId,
          changes,
        );

        return;
      }

      default: {
        const exhaustiveCheck: never =
          request;

        throw new BadRequestException(
          `Tipo de promoción no soportado: ${String(
            exhaustiveCheck,
          )}`,
        );
      }
    }
  }

  private async removePromotion(
    publication: PublicationKind,
    promotion: ManagedActivePromotion,
  ): Promise<void> {
    const type =
      promotion.type as
        | ManagedPromotionType
        | null
        | undefined;

    switch (type) {
      case 'PRICE_DISCOUNT': {
        if (
          publication.type ===
          'CLASSIC'
        ) {
          await this.priceDiscountService.deleteClassicPriceDiscount(
            publication.itemId,
          );

          return;
        }

        await this.priceDiscountService.deleteNewPriceDiscount(
          publication.familyId,
          publication.itemId,
        );

        return;
      }

      case 'DEAL': {
        const promotionId =
          this.requirePromotionId(
            promotion,
          );

        if (
          publication.type ===
          'CLASSIC'
        ) {
          await this.dealService.deleteClassic(
            publication.itemId,
            promotionId,
          );

          return;
        }

        await this.dealService.deleteNew(
          publication.familyId,
          publication.itemId,
          promotionId,
        );

        return;
      }

      case 'SELLER_CAMPAIGN': {
        const promotionId =
          this.requirePromotionId(
            promotion,
          );

        if (
          publication.type ===
          'CLASSIC'
        ) {
          await this.sellerCampaignService.deleteClassic(
            publication.itemId,
            promotionId,
          );

          return;
        }

        await this.sellerCampaignService.deleteNew(
          publication.familyId,
          publication.itemId,
          promotionId,
        );

        return;
      }

      case 'SMART': {
        const promotionId =
          this.requirePromotionId(
            promotion,
          );

        const offerId =
          this.requireOfferId(
            promotion,
          );

        if (
          publication.type ===
          'CLASSIC'
        ) {
          await this.smartPromotionService.deleteClassic(
            publication.itemId,
            promotionId,
            offerId,
          );

          return;
        }

        await this.smartPromotionService.deleteNew(
          publication.familyId,
          publication.itemId,
          promotionId,
          offerId,
        );

        return;
      }

      default:
        throw new BadRequestException(
          `No sabemos eliminar la promoción activa de tipo ${String(
            type,
          )}`,
        );
    }
  }

  private async waitForPromotion(
    itemId: string,
    expectedType: ManagedPromotionType,
  ): Promise<ManagedActivePromotion | null> {
    for (
      let attempt = 0;
      attempt < 10;
      attempt++
    ) {
      const detail =
        await this.publicationDetailService.getDetail(
          itemId,
        );

      const active =
        this.getFirstActivePromotion(
          detail.promotions?.active,
        );

      if (
        active?.type ===
        expectedType
      ) {
        return active;
      }

      await this.delay(1000);
    }

    return null;
  }

  private async waitForNoActivePromotion(
    itemId: string,
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt < 10;
      attempt++
    ) {
      const detail =
        await this.publicationDetailService.getDetail(
          itemId,
        );

      const active =
        this.getFirstActivePromotion(
          detail.promotions?.active,
        );

      if (!active) {
        return;
      }

      await this.delay(1000);
    }
  }

  private getFirstActivePromotion(
    promotions:
      | ManagedActivePromotion[]
      | undefined,
  ): ManagedActivePromotion | null {
    if (
      !Array.isArray(promotions) ||
      promotions.length === 0
    ) {
      return null;
    }

    return promotions[0] ?? null;
  }

  private requirePromotionId(
    promotion: ManagedActivePromotion,
  ): string {
    if (
      typeof promotion.id !==
        'string' ||
      !promotion.id
    ) {
      throw new BadRequestException(
        'La promoción activa no tiene promotionId',
      );
    }

    return promotion.id;
  }

  private requireOfferId(
    promotion: ManagedActivePromotion,
  ): string {
    if (
      typeof promotion.ref_id !==
        'string' ||
      !promotion.ref_id
    ) {
      throw new BadRequestException(
        'La promoción SMART activa no tiene offerId',
      );
    }

    return promotion.ref_id;
  }

  private async waitForCandidate(
    itemId: string,
    request: PromotionSwitchRequest,
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt < 10;
      attempt++
    ) {
      const detail =
        await this.publicationDetailService.getDetail(
          itemId,
        );

      const candidates =
        (detail.promotions?.candidates ??
          []) as ManagedActivePromotion[];

      const candidate =
        candidates.find(
          (promotion) => {
            if (
              promotion.type !==
              request.type
            ) {
              return false;
            }

            if (
              request.type ===
              'PRICE_DISCOUNT'
            ) {
              return true;
            }

            if (
              promotion.id !==
              request.promotionId
            ) {
              return false;
            }

            if (
              request.type ===
              'SMART'
            ) {
              return (
                promotion.ref_id ===
                request.offerId
              );
            }

            return true;
          },
        );

      if (candidate) {
        return;
      }

      await this.delay(1000);
    }

    throw new BadRequestException(
      `Mercado Libre todavía no habilitó el candidato ${request.type}`,
    );
  }

  private delay(
    milliseconds: number,
  ): Promise<void> {
    return new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          milliseconds,
        ),
    );
  }
}
