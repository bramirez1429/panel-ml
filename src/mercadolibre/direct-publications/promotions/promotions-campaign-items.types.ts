export type PromotionCampaignItemsQuery = Readonly<{
  promotionType: string;
  limit?: number;
  offset?: number;
}>;

export type PromotionCampaignItem = Readonly<{
  itemId: string;
  title: string | null;
  thumbnail: string | null;
  status: string | null;
  eligible: boolean | null;
  currentPrice: number | null;
  promotionPrice: number | null;
  minPromotionPrice: number | null;
  maxPromotionPrice: number | null;
  suggestedPromotionPrice: number | null;
  requiresPriceSelection: boolean | null;
  sellerDiscountAmount: number | null;
  mercadoLibreBaseContributionAmount: number | null;
  mercadoLibreBoostAmount: number | null;
  mercadoLibreContributionAmount: number | null;
  estimatedNetAmount: number | null;
}>;

export type PromotionCampaignItemsPaging = Readonly<{
  total: number;
  offset: number;
  limit: number;
}>;
