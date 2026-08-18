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

export class PublicationDetailMapper {
  static getVersion(item: MlItem): {
    version: PublicationVersion;
    versionLabel: PublicationVersionLabel;
  } {
    const model = PublicationsMapper.getModel(item);

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

  static getStatus(status?: string | null): FriendlyStatus {
    const labels: Record<string, string> = {
      active: 'Activa',
      paused: 'Pausada',
      closed: 'Finalizada',
      under_review: 'En revisión',
      inactive: 'Inactiva',
    };

    return {
      code: status ?? null,
      label: status ? labels[status] ?? status : 'Sin estado',
    };
  }

  static getPricing(price: {
    current?: number | null;
    regular?: number | null;
    standard?: number | null;
    currency?: string | null;
  }): FriendlyPricing {
    const current = price.current ?? null;
    const regular = price.regular ?? null;

    const hasDiscount =
      current !== null &&
      regular !== null &&
      regular > current;

    const discountPercent =
      hasDiscount && regular
        ? Math.round(((regular - current!) / regular) * 100)
        : 0;

    return {
      current,
      regular,
      standard: price.standard ?? null,
      currency: price.currency ?? null,
      hasDiscount,
      discountPercent,
    };
  }

  static getPromotion(promotions: {
    active?: unknown[];
    candidates?: unknown[];
    pending?: unknown[];
  }): FriendlyPromotion {
    const activeCount = promotions.active?.length ?? 0;
    const candidateCount = promotions.candidates?.length ?? 0;
    const pendingCount = promotions.pending?.length ?? 0;

    return {
      hasActivePromotion: activeCount > 0,
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
      logisticType === 'self_service';

    const isFull =
      logisticType === 'fulfillment';

    let label = 'Envío estándar';

    if (isFlex) {
      label = 'Mercado Envíos Flex';
    } else if (isFull) {
      label = 'Mercado Libre Full';
    } else if (logisticType === 'drop_off') {
      label = 'Drop off';
    } else if (logisticType) {
      label = logisticType;
    }

    return {
      freeShipping:
        shipping?.free_shipping ?? false,

      logisticType,
      mode: shipping?.mode ?? null,

      isFlex,
      isFull,

      label,
    };
  }
}
