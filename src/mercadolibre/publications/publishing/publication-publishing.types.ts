export type PublishingModel = 'USER_PRODUCTS' | 'LEGACY';

export type DraftAttribute = Readonly<{
  id: string;
  valueId?: string;
  valueName?: string;
}>;

export type DraftVariation = Readonly<{
  sku: string | null;
  price: number;
  stock: number;
  attributes: DraftAttribute[];
  pictures: string[];
}>;

export type PublicationDraft = Readonly<{
  categoryId: string;
  title: string | null;
  familyName: string | null;
  currencyId: string;
  price: number;
  stock: number;
  listingTypeId: string;
  condition: string;
  description: string | null;
  attributes: DraftAttribute[];
  saleTerms: DraftAttribute[];
  variations: DraftVariation[];
  pictures: string[];
  shipping: {
    mode?: string;
    freeShipping?: boolean;
    localPickup?: boolean;
  };
}>;

export type PublishingContext = Readonly<{
  sellerId: number;
  accessToken: string;
  usesUserProducts: boolean;
  managesWarehouse: boolean;
}>;

export type PlannedItem = Readonly<{
  description: string | null;
  payload: Record<string, unknown>;
}>;

export type PublishingPlan = Readonly<{
  context: PublishingContext;
  model: PublishingModel;
  items: PlannedItem[];
}>;
