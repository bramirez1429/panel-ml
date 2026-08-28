export type PromotionDiagnosticEntry = Readonly<{
  id: string | null;
  type: string | null;
  status: string | null;
  originalPrice: number | null;
  price: number | null;
  minDiscountedPrice: number | null;
  maxDiscountedPrice: number | null;
  suggestedDiscountedPrice: number | null;
  meliPercentage: number | null;
  sellerPercentage: number | null;
  discountMeliAmount: number | null;
  discountMeliBoostAmount: number | null;
  offerId: string | null;
}>;

export type PromotionDiagnostic = Readonly<{
  itemId: string;
  promotions: PromotionDiagnosticEntry[];
}>;
