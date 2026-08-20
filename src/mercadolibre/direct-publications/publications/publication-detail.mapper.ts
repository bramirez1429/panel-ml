import { MlItem } from '../items/items.types';

import {
  FriendlyPricing,
  FriendlyPromotion,
  FriendlyShipping,
  FriendlyStatus,
  PublicationVersion,
  PublicationVersionLabel,
} from './publication-detail.types';

import { PublicationsMapper } from './publications.mapper';

type PromotionLike = {
  id?: string | null;
  price?: number | null;
  [key: string]: unknown;
};

type PriceLike = {
  current?: number | null;
  regular?: number | null;
  standard?: number | null;
  currency?: string | null;

  all?: Array<{
    type?: string | null;
    amount?: number | null;
    regular_amount?: number | null;
  }>;

  metadata?: {
    campaign_id?: string | null;
    promotion_id?: string | null;
    promotion_type?: string | null;
    [key: string]: unknown;
  };
};

export class PublicationDetailMapper {
  static getVersion(item: MlItem): {
    version: PublicationVersion;
    versionLabel: PublicationVersionLabel;
  } {
    const model =
      PublicationsMapper.getModel(item);

    if (model === 'VARIANT_PRICING') {
      return {
        version: 'NEW',
        versionLabel: 'Versión nueva',
      };
    }

    return {
      version: 'CLASSIC',
      versionLabel: 'Versión clásica',
    };
  }

  static getStatus(
    status?: string | null,
  ): FriendlyStatus {
    const labels: Record<string, string> = {
      active: 'Activa',
      paused: 'Pausada',
      closed: 'Finalizada',
      under_review: 'En revisión',
      inactive: 'Inactiva',
    };

    return {
      code: status ?? null,

      label: status
        ? labels[status] ?? status
        : 'Sin estado',
    };
  }

  static getPricing(
    price: PriceLike,
  ): FriendlyPricing {
    const current =
      price.current ?? null;

    const regular =
      price.regular ?? null;

    const hasDiscount =
      current !== null &&
      regular !== null &&
      regular > current;

    const discountPercent =
      hasDiscount && regular
        ? Math.round(
            ((regular - current!) /
              regular) *
              100,
          )
        : 0;

    return {
      current,
      regular,
      standard:
        price.standard ?? null,
      currency:
        price.currency ?? null,
      hasDiscount,
      discountPercent,
    };
  }

  /**
   * Mercado Libre puede tardar algunos segundos
   * en sincronizar /seller-promotions después
   * de un PUT o DELETE.
   *
   * El precio efectivo del item es nuestra
   * confirmación final de que la promoción
   * realmente está aplicada.
   */
  static reconcilePromotions<
    T extends PromotionLike,
  >(
    price: PriceLike,
    promotions: {
      active?: T[];
      candidates?: T[];
      pending?: T[];
      all?: T[];
    },
  ) {
    const current =
      price.current ?? null;

    const regular =
      price.regular ?? null;

    const hasPromotionPrice =
      price.all?.some(
        (entry) =>
          entry.type === 'promotion',
      ) ??
      false;

    const hasDiscount =
      current !== null &&
      regular !== null &&
      regular > current;

    const promotionIsEffective =
      hasPromotionPrice ||
      hasDiscount;

    if (!promotionIsEffective) {
      return {
        ...promotions,
        active: [],
      };
    }

    const campaignId =
      price.metadata?.campaign_id ??
      null;

    const active =
      (promotions.active ?? [])
        .filter((promotion) => {
          if (!campaignId) {
            return true;
          }

          return (
            promotion.id ===
            campaignId
          );
        })
        .map((promotion) => ({
          ...promotion,

          ...(current !== null
            ? {
                price: current,
              }
            : {}),
        }));

    return {
      ...promotions,
      active,
    };
  }

  static getPromotion(
    promotions: {
      active?: unknown[];
      candidates?: unknown[];
      pending?: unknown[];
    },
  ): FriendlyPromotion {
    const activeCount =
      promotions.active?.length ?? 0;

    const candidateCount =
      promotions.candidates?.length ??
      0;

    const pendingCount =
      promotions.pending?.length ?? 0;

    return {
      hasActivePromotion:
        activeCount > 0,

      activeCount,
      candidateCount,
      pendingCount,
    };
  }

  static getShipping(
    shipping?: MlItem['shipping'],
  ): FriendlyShipping {
    const logisticType =
      shipping?.logistic_type ?? null;

    const isFlex =
      logisticType ===
      'self_service';

    const isFull =
      logisticType ===
      'fulfillment';

    let label =
      'Envío estándar';

    if (isFlex) {
      label =
        'Mercado Envíos Flex';
    } else if (isFull) {
      label =
        'Mercado Libre Full';
    } else if (
      logisticType === 'drop_off'
    ) {
      label = 'Drop off';
    } else if (logisticType) {
      label = logisticType;
    }

    return {
      freeShipping:
        shipping?.free_shipping ??
        false,

      logisticType,
      mode:
        shipping?.mode ?? null,

      isFlex,
      isFull,

      label,
    };
  }
}
