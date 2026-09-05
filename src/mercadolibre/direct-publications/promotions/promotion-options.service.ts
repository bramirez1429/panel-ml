import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { ItemsService } from '../items/items.service';

import {
  normalizePromotion,
  promotionBuyerPrice,
  toPromotionCandidate,
} from './promotions-catalog.helpers';

import type {
  PromotionOption,
} from './promotions-catalog.types';

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

import type {
  MlPromotion,
  MlPromotionCampaignItem,
} from './promotions.types';

const SUPPORTED_TYPES = new Set([
  'PRICE_DISCOUNT',
  'DEAL',
  'SELLER_CAMPAIGN',
  'SMART',
]);

const ITEM_SCOPED_ONLY_TYPES =
  new Set([
    'PRICE_DISCOUNT',
  ]);

@Injectable()
export class PromotionOptionsService {
  constructor(
    private readonly tokenService:
      MercadolibreTokenService,

    private readonly itemsService:
      ItemsService,

    private readonly promotionsService:
      PromotionsService,

    private readonly sellingFeeService:
      MercadoLibreSellingFeeService,
  ) {}

  async getOptions(
    userId: string,
    itemId: string,
  ): Promise<PromotionOption[]> {
    const connection =
      await this.tokenService
        .getStoredConnection(userId);

    const accessToken =
      await this.tokenService
        .getValidAccessToken(
          userId,
          connection,
        );

    const item =
      await this.itemsService.getOne(
        itemId,
        accessToken,
      );

    const candidate =
      toPromotionCandidate(item);

    if (!candidate) {
      throw promotionError(
        'PROMOTION_NOT_FOUND',
        'No se encontró una publicación promocionable',
      );
    }

    /*
     * 1. Promociones asociadas al MLA.
     */
    const promotions =
      await this.promotionsService
        .getPromotions(
          userId,
          itemId,
          accessToken,
        );

    /*
     * 2. Metadata general de campañas:
     * nombre, fechas, etc.
     */
    const sellerCampaigns =
      await this.getSellerCampaignsSafe(
        userId,
        connection.seller_id,
        accessToken,
      );

    const campaignById =
      campaignMapOf(sellerCampaigns);

    const promotionsByStatus = [
      ...promotions.active.map(
        (promotion) => ({
          promotion,
          status: 'started' as const,
        }),
      ),

      ...promotions.candidates.map(
        (promotion) => ({
          promotion,
          status: 'candidate' as const,
        }),
      ),

      ...promotions.pending.map(
        (promotion) => ({
          promotion,
          status: 'pending' as const,
        }),
      ),
    ];

    /*
     * 3. Para cada promoción consultamos,
     * cuando ML lo permite, el detalle
     * EXACTO de este MLA dentro de
     * esta campaña.
     */
    const enriched =
      await Promise.all(
        promotionsByStatus.map(
          async ({
            promotion,
            status,
          }) => {
            const promotionId =
              textOrNull(promotion.id);

            const promotionType =
              textOrNull(promotion.type);

            const campaign =
              promotionId
                ? campaignById.get(
                    promotionId,
                  ) ?? null
                : null;

            const directed =
              promotionId &&
              promotionType &&
              shouldQueryCampaignItem(
                promotionType,
              )
                ? await this
                    .promotionsService
                    .getCampaignItem(
                      userId,
                      promotionId,
                      promotionType,
                      itemId,
                      accessToken,
                    )
                : null;

            return {
              promotion:
                enrichPromotion(
                  promotion,
                  campaign,
                  directed,
                ),
              status,
            };
          },
        ),
      );

    const prepared =
      enriched.map(
        ({
          promotion,
          status,
        }) => {
          const normalized =
            normalizePromotion(
              promotion,
            );

          const financial =
            normalizePromotionFinancialPreview({
              promotionType:
                normalized.type,

              currentPrice:
                normalized.originalPrice ??
                candidate.price,

              /*
               * Si existe boost usamos el
               * precio FINAL documentado por ML.
               */
              rawPromotionPrice:
                promotionBuyerPriceForOption(
                  promotion,
                  status,
                ),

              minPromotionPrice:
                finiteNumber(
                  promotion
                    .min_discounted_price,
                ),

              maxPromotionPrice:
                finiteNumber(
                  promotion
                    .max_discounted_price,
                ),

              suggestedPromotionPrice:
                finiteNumber(
                  promotion
                    .suggested_discounted_price,
                ),

              meliPercentage:
                promotionMeliPercentage(
                  promotion,
                ),

              sellerPercentage:
                promotionSellerPercentage(
                  promotion,
                ),

              discountMeliAmount:
                finiteNumber(
                  promotion
                    .discount_meli_amount,
                ),

              discountMeliBoostAmount:
                finiteNumber(
                  promotion
                    .discount_meli_boost_amount,
                ),

              deferFinancialsWhenPriceSelectionRequired:
                status === 'candidate',
            });

          return {
            promotion,
            status,
            normalized,
            financial,
          };
        },
      );

    const requestEntries =
      prepared.flatMap(
        (entry, index) => {
          const effectivePrice =
            entry.financial
              .effectiveCalculationPrice;

          const suggestedPrice =
            suggestedSimulationPrice(
              entry.financial,
            );

          return [
            ...(
              effectivePrice !== null
                ? [
                    {
                      index,
                      target:
                        'estimated' as const,

                      request: {
                        candidate,

                        effectivePrice:
                          sellerGrossPrice(
                            effectivePrice,
                            entry
                              .financial
                              .mercadoLibreContributionAmount,
                          ),

                        shippingPrice:
                          effectivePrice,
                      },
                    },
                  ]
                : []
            ),

            ...(
              suggestedPrice !== null
                ? [
                    {
                      index,
                      target:
                        'suggested' as const,

                      request: {
                        candidate,

                        effectivePrice:
                          sellerGrossPrice(
                            suggestedPrice,
                            entry
                              .financial
                              .mercadoLibreContributionAmount,
                          ),

                        shippingPrice:
                          suggestedPrice,
                      },
                    },
                  ]
                : []
            ),
          ];
        },
      );

    const requests:
      SellingFeeRequest[] =
        requestEntries.map(
          ({ request }) => request,
        );

    const estimates =
      requests.length
        ? await this
            .sellingFeeService
            .getMany(
              requests,
              accessToken,
              connection.seller_id,
            )
        : [];

    const estimateByIndex =
      new Map<
        number,
        SellingFeeResult | null
      >();

    const suggestedEstimateByIndex =
      new Map<
        number,
        SellingFeeResult | null
      >();

    requestEntries.forEach(
      (
        {
          index,
          target,
        },
        estimateIndex,
      ) => {
        const estimate =
          estimates[estimateIndex] ??
          null;

        if (
          target === 'suggested'
        ) {
          suggestedEstimateByIndex
            .set(
              index,
              estimate,
            );
        } else {
          estimateByIndex.set(
            index,
            estimate,
          );
        }
      },
    );

    return prepared.map(
      (entry, index) => {
        const estimate =
          estimateByIndex.get(
            index,
          ) ?? null;

        const suggestedEstimate =
          suggestedEstimateByIndex
            .get(index) ?? null;

        return toPromotionOption(
          entry,
          estimate,
          suggestedEstimate,
        );
      },
    );
  }

  private async getSellerCampaignsSafe(
    userId: string,
    sellerId: number,
    accessToken: string,
  ): Promise<MlPromotion[]> {
    try {
      return await this
        .promotionsService
        .getSellerCampaigns(
          userId,
          sellerId,
          accessToken,
        );
    } catch {
      return [];
    }
  }
}

function toPromotionOption(
  entry: Readonly<{
    promotion: MlPromotion;
    status:
      | 'started'
      | 'candidate'
      | 'pending';
    normalized:
      ReturnType<
        typeof normalizePromotion
      >;
    financial:
      PromotionFinancialPreview;
  }>,
  estimate:
    SellingFeeResult | null,
  suggestedEstimate:
    SellingFeeResult | null,
): PromotionOption {
  const promotion =
    entry.promotion;

  return {
    ...entry.normalized,

    status: entry.status,

    promotionPrice:
      entry.financial
        .promotionPrice,

    minPromotionPrice:
      entry.financial
        .minPromotionPrice,

    maxPromotionPrice:
      entry.financial
        .maxPromotionPrice,

    suggestedPromotionPrice:
      entry.financial
        .suggestedPromotionPrice,

    requiresPriceSelection:
      entry.financial
        .requiresPriceSelection,

    sellerDiscountAmount:
      entry.financial
        .sellerDiscountAmount,

    sellerPercentage:
      promotionSellerPercentage(
        promotion,
      ),

    mercadoLibrePercentage:
      promotionMeliPercentage(
        promotion,
      ),

    mercadoLibreBoostedPercentage:
      finiteNumber(
        promotion
          .discount_meli_boosted_percentage,
      ),

    boostedOffer:
      booleanOrNull(
        promotion.boosted_offer,
      ),

    totalPriceForBoostedOffer:
      finiteNumber(
        promotion
          .total_price_for_boosted_offer,
      ),

    mercadoLibreBaseContributionAmount:
      entry.financial
        .mercadoLibreBaseContributionAmount,

    mercadoLibreBoostAmount:
      entry.financial
        .mercadoLibreBoostAmount,

    mercadoLibreContributionAmount:
      entry.financial
        .mercadoLibreContributionAmount,

    estimatedNetAmount:
      estimate
        ?.estimatedNetAmount ??
      null,

    suggestedEstimatedNetAmount:
      suggestedEstimate
        ?.estimatedNetAmount ??
      null,

    canApply:
      entry.status === 'candidate' &&
      SUPPORTED_TYPES.has(
        promotion.type
          ?.toUpperCase() ??
          '',
      ),

    canRemove:
      entry.status === 'started' ||
      entry.status === 'pending',

    saleEstimate:
      estimate,
  };
}

function enrichPromotion(
  itemPromotion: MlPromotion,
  campaign: MlPromotion | null,
  directed:
    MlPromotionCampaignItem | null,
): MlPromotion {
  /*
   * Prioridad financiera:
   *
   * directed item/campaign
   * > item promotion
   * > campaign metadata
   */
  let merged: MlPromotion = {};

  merged = mergeDefined(
    merged,
    campaign,
  );

  merged = mergeDefined(
    merged,
    itemPromotion,
  );

  merged = mergeDefined(
    merged,
    directed,
  );

  /*
   * Para datos descriptivos,
   * la campaña general suele tener
   * un nombre más útil que el
   * texto genérico del ítem.
   */
  const name =
    firstText(
      directed?.name,
      campaign?.name,
      itemPromotion.name,
    );

  const startDate =
    firstText(
      directed?.start_date,
      itemPromotion.start_date,
      campaign?.start_date,
    );

  const finishDate =
    firstText(
      directed?.finish_date,
      directed?.end_date,
      itemPromotion.finish_date,
      itemPromotion.end_date,
      campaign?.finish_date,
      campaign?.end_date,
    );

  const promotionId =
    firstText(
      itemPromotion.id,
      campaign?.id,
    );

  const promotionType =
    firstText(
      itemPromotion.type,
      campaign?.type,
    );

  const dealCandidate =
    isDealCandidate(
      itemPromotion,
    );

  return {
    ...merged,

    /*
     * En DEAL candidate conservamos los
     * términos financieros recibidos por
     * /seller-promotions/items/{MLA}.
     *
     * El detalle de campaign/items puede
     * traer una recomendación distinta y
     * no debe reemplazar el rango principal.
     */
    ...(dealCandidate
      ? {
          price:
            itemPromotion.price,

          original_price:
            itemPromotion.original_price,

          min_discounted_price:
            itemPromotion.min_discounted_price,

          max_discounted_price:
            itemPromotion.max_discounted_price,

          suggested_discounted_price:
            itemPromotion.suggested_discounted_price,

          meli_percentage:
            itemPromotion.meli_percentage,

          seller_percentage:
            itemPromotion.seller_percentage,

          discount_meli_amount:
            itemPromotion.discount_meli_amount,

          discount_meli_boost_amount:
            itemPromotion.discount_meli_boost_amount,

          boosted_offer:
            itemPromotion.boosted_offer,

          discount_meli_boosted_percentage:
            itemPromotion
              .discount_meli_boosted_percentage,

          total_price_for_boosted_offer:
            itemPromotion
              .total_price_for_boosted_offer,
        }
      : {}),

    /*
     * El endpoint campaign/items devuelve
     * id = MLA..., NO promotionId.
     *
     * Nunca permitimos que ese id pise
     * el identificador real P-....
     */
    ...(promotionId
      ? { id: promotionId }
      : {}),

    ...(promotionType
      ? { type: promotionType }
      : {}),

    ...(name
      ? { name }
      : {}),

    ...(startDate
      ? {
          start_date:
            startDate,
        }
      : {}),

    ...(finishDate
      ? {
          finish_date:
            finishDate,
        }
      : {}),
  };
}

function campaignMapOf(
  campaigns:
    readonly MlPromotion[],
): Map<string, MlPromotion> {
  const result =
    new Map<
      string,
      MlPromotion
    >();

  campaigns.forEach(
    (campaign) => {
      const id =
        textOrNull(
          campaign.id,
        );

      if (id) {
        result.set(
          id,
          campaign,
        );
      }
    },
  );

  return result;
}

function shouldQueryCampaignItem(
  type: string,
): boolean {
  return !ITEM_SCOPED_ONLY_TYPES.has(
    type.toUpperCase(),
  );
}

function mergeDefined(
  target: MlPromotion,
  source:
    | MlPromotion
    | MlPromotionCampaignItem
    | null,
): MlPromotion {
  if (!source) {
    return target;
  }

  const result:
    Record<string, unknown> = {
      ...target,
  };

  Object.entries(source)
    .forEach(
      ([key, value]) => {
        if (
          value !== undefined
        ) {
          result[key] =
            value;
        }
      },
    );

  return result as MlPromotion;
}

function promotionMeliPercentage(
  promotion: MlPromotion,
): number | null {
  return (
    finiteNumber(
      promotion.meli_percentage,
    ) ??
    finiteNumber(
      promotion
        .benefits
        ?.meli_percent,
    )
  );
}

function promotionSellerPercentage(
  promotion: MlPromotion,
): number | null {
  return (
    finiteNumber(
      promotion
        .seller_percentage,
    ) ??
    finiteNumber(
      promotion
        .benefits
        ?.seller_percent,
    )
  );
}

function promotionBuyerPriceForOption(
  promotion: MlPromotion,
  status:
    | 'started'
    | 'candidate'
    | 'pending',
): number | null {
  const buyerPrice =
    promotionBuyerPrice(
      promotion,
    );

  /*
   * DEAL candidate llega con price = 0.
   *
   * En la Central de promociones ML
   * presenta max_discounted_price como
   * el precio de entrada para participar.
   */
  if (
    status === 'candidate' &&
    isDealCandidate(promotion) &&
    (buyerPrice === null ||
      buyerPrice === 0)
  ) {
    return (
      finiteNumber(
        promotion
          .max_discounted_price,
      ) ??
      buyerPrice
    );
  }

  return buyerPrice;
}

function isDealCandidate(
  promotion: MlPromotion,
): boolean {
  return (
    textOrNull(
      promotion.type,
    )?.toUpperCase() ===
      'DEAL' &&
    textOrNull(
      promotion.status,
    )?.toLowerCase() ===
      'candidate'
  );
}

function suggestedSimulationPrice(
  financial:
    PromotionFinancialPreview,
): number | null {
  return (
    financial
      .requiresPriceSelection &&
    financial
      .suggestedPromotionPrice !==
      null &&
    financial
      .suggestedPromotionPrice >
      0
  )
    ? financial
        .suggestedPromotionPrice
    : null;
}

function sellerGrossPrice(
  buyerPrice: number,
  mercadoLibreContributionAmount:
    number | null,
): number {
  const contribution =
    mercadoLibreContributionAmount !==
      null &&
    mercadoLibreContributionAmount >
      0
      ? mercadoLibreContributionAmount
      : 0;

  return Math.round(
    (
      buyerPrice +
      contribution
    ) * 100,
  ) / 100;
}

function finiteNumber(
  value: unknown,
): number | null {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function booleanOrNull(
  value: unknown,
): boolean | null {
  return typeof value === 'boolean'
    ? value
    : null;
}

function textOrNull(
  value: unknown,
): string | null {
  return (
    typeof value === 'string' &&
    value.trim()
  )
    ? value.trim()
    : null;
}

function firstText(
  ...values: unknown[]
): string | null {
  for (const value of values) {
    const text =
      textOrNull(value);

    if (text) {
      return text;
    }
  }

  return null;
}
