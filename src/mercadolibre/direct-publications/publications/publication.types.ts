import { FamilySummary } from '../families/family.types';

export type PublicationModel = 'SHARED' | 'VARIANT_PRICING';

export type SharedProduct = {
  key: string;
  model: 'SHARED';

  itemId: string;
  title: string | null;

  price: number | null;
  stock: number;
  sold: number;

  status: string | null;

  thumbnail: string | null;

  variations: unknown[];
};

export type GroupedProduct = SharedProduct | FamilySummary;

export type GroupedPublicationsResponse = {
  done: boolean;

  nextCursor: string | null;

  rawItemsCount: number;
  productsCount: number;

  products: GroupedProduct[];
};
