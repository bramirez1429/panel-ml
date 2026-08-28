import type { MlPromotions } from './promotions.types';
import type { PromotionProductGroup } from './promotions-product-group';

export type PromotionCatalogStatus =
  'ACTIVE' | 'AVAILABLE' | 'PENDING' | 'NONE';

export type PromotionCatalogQuery = Readonly<{
  limit: number;
  cursor?: string;
  search?: string;
  productGroup?: PromotionProductGroup;
  promotionStatus?: PromotionCatalogStatus;
  promotionType?: string;
}>;

export type NormalizedPromotion = Readonly<{
  id: string | null;
  offerId: string | null;
  type: string | null;
  name: string | null;
  originalPrice: number | null;
  promotionPrice: number | null;
  discountPercent: number | null;
  startDate: string | null;
  finishDate: string | null;
}>;

export type PromotionOption = NormalizedPromotion &
  Readonly<{
    status: string | null;
    minPromotionPrice: number | null;
    maxPromotionPrice: number | null;
    suggestedPromotionPrice: number | null;
    requiresPriceSelection: boolean | null;
    sellerDiscountAmount: number | null;
    mercadoLibreBaseContributionAmount: number | null;
    mercadoLibreBoostAmount: number | null;
    mercadoLibreContributionAmount: number | null;
    estimatedNetAmount: number | null;
    suggestedEstimatedNetAmount: number | null;
    canApply: boolean;
    canRemove: boolean;
    saleEstimate: Readonly<{
      saleFeeAmount: number;
      estimatedNetAmount: number;
    }> | null;
  }>;

export type PromotionCatalogCandidate = Readonly<{
  itemId: string;
  familyId: string | null;
  title: string;
  thumbnail: string | null;
  productGroup: PromotionProductGroup;
  price: number;
  categoryId: string;
  listingTypeId: string | null;
  shippingMode: string | null;
  logisticType: string | null;
}>;

export type PromotionSummary = Readonly<{
  status: PromotionCatalogStatus;
  activeTypes: readonly string[];
  candidateTypes: readonly string[];
  pendingTypes: readonly string[];
}>;

export type PromotionCatalogMatch = Readonly<{
  candidate: PromotionCatalogCandidate;
  promotions: MlPromotions;
  summary: PromotionSummary;
}>;

export type PromotionCatalogRow = Readonly<{
  itemId: string;
  familyId: string | null;
  title: string;
  thumbnail: string | null;
  productGroup: PromotionProductGroup;
  price: number;
  currentPromotion: NormalizedPromotion | null;
  hasActivePromotion: boolean;
  availablePromotionsCount: number;
  promotionStatus: PromotionCatalogStatus;
}>;
