export type PromotionCampaignItemsQuery = Readonly<{
  promotionType: string;
  limit?: number;
  offset?: number;
}>;

export type PromotionCampaignItem = Readonly<{
  itemId: string;
  status?: string;
  price?: number;
  promotionPrice?: number;
}>;

export type PromotionCampaignItemsPaging = Readonly<{
  total: number;
  offset: number;
  limit: number;
}>;
