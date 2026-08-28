export type PromotionCampaign = Readonly<{
  id: string;
  name: string | null;
  type: string;
  status: 'started' | 'pending';
  startDate: string | null;
  finishDate: string | null;
  deadlineDate: string | null;
}>;
