export type PublicationVersion = 'CLASSIC' | 'NEW';

export type PublicationVersionLabel = 'Versión clásica' | 'Versión nueva';

export type FriendlyStatus = {
  code: string | null;
  label: string;
};

export type FriendlyPricing = {
  current: number | null;
  regular: number | null;
  standard: number | null;
  currency: string | null;

  hasDiscount: boolean;
  discountPercent: number;
};

export type FriendlyPromotion = {
  hasActivePromotion: boolean;
  activeCount: number;
  candidateCount: number;
  pendingCount: number;
};

export type FriendlyShipping = {
  freeShipping: boolean;

  logisticType: string | null;
  mode: string | null;

  isFlex: boolean;
  isFull: boolean;

  label: string;
};

export type PublicationIdentifiers = {
  itemId: string | null;
  familyId: string | null;
  userProductId: string | null;
};
