export type PublicationSearchCriteria =
  | { type: 'FAMILY'; value: string }
  | { type: 'MLA'; value: string }
  | { type: 'TITLE'; value: string };

export type PublicationSearchItem = {
  itemId: string;
  familyId: string | null;
  title: string | null;
  thumbnail: string | null;
  price: number | null;
  currencyId: string | null;
  status: string | null;
  stock: number | null;
  sold: number | null;
  permalink: string | null;
  model: 'SHARED' | 'VARIANT_PRICING';
};

export type PublicationSearchResult = {
  criteria: PublicationSearchCriteria;
  done: boolean;
  nextCursor: string | null;
  itemsCount: number;
  items: PublicationSearchItem[];
};
