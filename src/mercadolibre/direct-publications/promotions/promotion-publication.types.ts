export type PromotionPublication =
  | { type: 'CLASSIC'; itemId: string }
  | { type: 'NEW'; familyId: string; itemId: string };
