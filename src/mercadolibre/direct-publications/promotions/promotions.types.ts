export type MlPromotion = {
  id?: string;
  type?: string;
  ref_id?: string | null;
  offer_id?: string | null;
  sub_type?: string;
  status?: string;

  price?: number;
  original_price?: number;

  start_date?: string;
  finish_date?: string;
  deadline_date?: string;

  name?: string;

  [key: string]: unknown;
};

export type MlSellerPromotionsResponse = {
  results: MlPromotion[];
};

export type MlPromotionCampaignItem = {
  id?: string;
  status?: string;
  price?: number;
  original_price?: number;
  promotion_price?: number;
  discount_meli_amount?: number;
  discount_meli_boost_amount?: number;
  [key: string]: unknown;
};

export type MlPromotionCampaignItemsResponse = {
  results: MlPromotionCampaignItem[];
  paging?: {
    total?: number;
    offset?: number;
    limit?: number;
  };
};

export type MlPromotions = Readonly<{
  active: MlPromotion[];
  candidates: MlPromotion[];
  pending: MlPromotion[];
  all: MlPromotion[];
}>;
