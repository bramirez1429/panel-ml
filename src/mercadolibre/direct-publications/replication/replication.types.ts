export type DirectReplicationProduct = Readonly<{
  sourceKey: string;
  itemIds: string[];
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

export type ReplicationVisitsRequest = Readonly<{
  days: unknown;
  products: unknown;
}>;

export type ReplicationVisitsResponse = Readonly<{
  items: readonly Readonly<{
    sourceKey: string;
    visits: number | null;
  }>[];
}>;
