export type ProductRankingRow = {
  title: string;
  sold: number;
  type: 'LEGACY' | 'USER_PRODUCT';
  itemIds: string[];
  familyId: string | null;
  userProductIds: string[];
  thumbnailUrl: string | null;
  variantsCount: number;
};

export type ProductRankingVariant = {
  id: string;
  label: string;
  itemId: string | null;
  userProductId: string | null;
  sold: number;
  thumbnailUrl: string | null;
};

export type ProductRankingResult = {
  totalProducts: number;
  productsWithSales: number;
  products: ProductRankingRow[];
};
