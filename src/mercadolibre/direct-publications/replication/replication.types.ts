export type DirectReplicationProduct = Readonly<{
  sourceKey: string;
  title: string;
  sold: number;
  priceFrom: number | null;
  priceTo: number | null;
  currency: string | null;
  thumbnailUrl: string | null;
  familyId: string | null;
  itemId: string | null;
  userProductId: string | null;
  type: 'LEGACY' | 'USER_PRODUCT';
}>;
