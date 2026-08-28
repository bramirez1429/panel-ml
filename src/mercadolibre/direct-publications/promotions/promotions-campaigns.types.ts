export type PromotionCampaignAudience = 'WOMEN' | 'GIRLS';

export type PromotionCampaignQuery = Readonly<{
  audience?: PromotionCampaignAudience;
}>;

export type PromotionCampaign = Readonly<{
  id: string;
  name: string;
  type: string;
  eligibleItems: number;
  startDate: string | null;
  finishDate: string | null;
}>;
