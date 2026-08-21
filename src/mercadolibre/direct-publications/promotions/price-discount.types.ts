export type PriceDiscountUpdate = {
  dealPrice: number;
  topDealPrice?: number;
  startDate: string;
  finishDate: string;
};

export type MlPromotionPriceResponse = {
  price?: number;
  top_price?: number;
  original_price?: number;
};
