import type { MlPromotion, MlPromotions } from './promotions.types';

export type PromotionCatalogStatus =
  | 'ACTIVE'
  | 'AVAILABLE'
  | 'PENDING'
  | 'NONE';

export type PromotionFacetFilter = Readonly<{
  attributeId: string;
  value: string;
}>;

export type PromotionCatalogQuery = Readonly<{
  limit: number;
  cursor?: string;
  search?: string;
  categoryId?: string;
  promotionStatus?: PromotionCatalogStatus;
  promotionType?: string;
  facetFilters?: readonly PromotionFacetFilter[];
}>;

export type PromotionCatalogAttribute = Readonly<{
  id: string;
  name: string;
  value: string;
}>;

export type PromotionCatalogCategory = Readonly<{
  id: string;
  name: string;
  path: readonly string[];
}>;

export type PromotionSummary = Readonly<{
  status: PromotionCatalogStatus;
  activeTypes: readonly string[];
  candidateTypes: readonly string[];
  pendingTypes: readonly string[];
}>;

export type PromotionCatalogRow = Readonly<{
  itemId: string;
  familyId: string | null;
  title: string;
  thumbnail: string | null;
  category: PromotionCatalogCategory;
  price: number;
  publicationStatus: string;
  attributes: readonly PromotionCatalogAttribute[];
  promotions: Readonly<{
    active: readonly MlPromotion[];
    candidates: readonly MlPromotion[];
    pending: readonly MlPromotion[];
    all: readonly MlPromotion[];
  }>;
  promotionSummary: PromotionSummary;
}>;

export type PromotionCatalogCandidate = Readonly<{
  itemId: string;
  familyId: string | null;
  title: string;
  thumbnail: string | null;
  categoryId: string;
  price: number;
  publicationStatus: string;
  attributes: readonly PromotionCatalogAttribute[];
}>;

export type PromotionCatalogMatch = Readonly<{
  candidate: PromotionCatalogCandidate;
  promotions: MlPromotions;
  summary: PromotionSummary;
}>;

export type PromotionCategoryFacet = PromotionCatalogCategory &
  Readonly<{ count: number }>;

export type PromotionAttributeFacet = Readonly<{
  id: string;
  name: string;
  values: readonly Readonly<{ value: string; count: number }>[];
}>;
