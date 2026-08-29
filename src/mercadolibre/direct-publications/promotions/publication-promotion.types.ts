import type { MlItem } from '../items/items.types';

import type {
  ManagedActivePromotion,
  PromotionSwitchRequest,
} from './promotion-manager.types';
import type { PromotionErrorCode } from './promotion-errors';
import type { PromotionPublication } from './promotion-publication.types';

export type ResolvedPromotionItem = Readonly<{
  item: MlItem;
  publication: PromotionPublication;
}>;

export type ResolvedPromotionSource = Readonly<{
  sourceKey: string;
  accessToken: string;
  items: ResolvedPromotionItem[];
}>;

export type PromotionSnapshot = Readonly<{
  id: string | null;
  type: string | null;
  offerId: string | null;
  status: string | null;
  price: number | null;
  originalPrice: number | null;
  startDate: string | null;
  finishDate: string | null;
}>;

export type PublicationPromotionPreviewItem = Readonly<{
  itemId: string;
  price: number | null;
  activePromotion: PromotionSnapshot | null;
  candidates: PromotionSnapshot[];
  requestedCandidate: PromotionSnapshot | null;
  applicable: boolean;
  unavailableReason: PromotionErrorCode | null;
}>;

export type PublicationPromotionPreview = Readonly<{
  sourceKey: string;
  totalItems: number;
  applicableItems: number;
  unavailableItems: number;
  items: PublicationPromotionPreviewItem[];
}>;

export type PromotionExecutionStage =
  | 'PRE_FLIGHT'
  | 'CURRENT_STATE'
  | 'REMOVAL'
  | 'REMOVAL_VERIFICATION'
  | 'CANDIDATE_REVALIDATION'
  | 'APPLICATION'
  | 'APPLICATION_VERIFICATION'
  | 'COMPLETED'
  | 'ALREADY_INACTIVE';

export type PromotionItemResult = Readonly<{
  itemId: string;
  success: boolean;
  stage: PromotionExecutionStage;
  errorCode?: PromotionErrorCode;
  providerMessage?: string;
}>;

export type PublicationPromotionResult = Readonly<{
  success: boolean;
  status: 'SUCCESS' | 'PARTIAL_FAILURE' | 'FAILURE';
  errorCode?: PromotionErrorCode;
  providerMessage?: string;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  results: PromotionItemResult[];
}>;

export type PromotionExecutionContext = Readonly<{
  userId: string;
  accessToken: string;
  resolvedItem: ResolvedPromotionItem;
  request: PromotionSwitchRequest;
}>;

export function promotionSnapshot(
  promotion: ManagedActivePromotion,
): PromotionSnapshot {
  return {
    id: textOrNull(promotion.id),
    type: textOrNull(promotion.type),
    offerId: textOrNull(promotion.ref_id ?? promotion.offer_id),
    status: textOrNull(promotion.status),
    price: numberOrNull(promotion.price),
    originalPrice: numberOrNull(promotion.original_price),
    startDate: textOrNull(promotion.start_date),
    finishDate: textOrNull(promotion.finish_date),
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
