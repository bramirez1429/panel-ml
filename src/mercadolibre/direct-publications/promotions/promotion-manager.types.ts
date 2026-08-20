export type ManagedPromotionType =
  | 'PRICE_DISCOUNT'
  | 'DEAL'
  | 'SELLER_CAMPAIGN'
  | 'SMART';

export type PriceDiscountPromotionRequest = {
  type: 'PRICE_DISCOUNT';
  dealPrice: number;
  topDealPrice?: number;
  startDate: string;
  finishDate: string;
};

export type DealPromotionRequest = {
  type: 'DEAL';
  promotionId: string;
  dealPrice: number;
  topDealPrice?: number;
};

export type SellerCampaignPromotionRequest = {
  type: 'SELLER_CAMPAIGN';
  promotionId: string;
  dealPrice: number;
};

export type SmartPromotionRequest = {
  type: 'SMART';
  promotionId: string;
  offerId: string;
};

export type PromotionSwitchRequest =
  | PriceDiscountPromotionRequest
  | DealPromotionRequest
  | SellerCampaignPromotionRequest
  | SmartPromotionRequest;

export type ManagedActivePromotion = {
  id?: string | null;
  type?: ManagedPromotionType | string | null;
  ref_id?: string | null;
  status?: string | null;
  price?: number | null;
  original_price?: number | null;
};

export type PromotionManagerResult = {
  success: boolean;

  previousPromotion:
    | ManagedActivePromotion
    | null;

  removedPreviousPromotion: boolean;

  requestedPromotion: ManagedPromotionType;

  activePromotion:
    | ManagedActivePromotion
    | null;

  verified: boolean;
};
