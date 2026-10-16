export type BulkEditChanges = Readonly<{
  price?: string;
  promotionalPrice?: string;
  stock?: number;
  locationId?: string;
}>;

export type BulkEditVariant = Readonly<{
  productId: string;
  productName: string;
  variantId: string;
  sku: string | null;
  optionValues: readonly string[];
  price: string;
  promotionalPrice: string | null;
  stock: number | null;
  inventoryLevels: readonly Readonly<{ locationId: string; stock: number }> [];
  url: string | null;
}>;

export type BulkEditSnapshot = Readonly<{
  id: string;
  user_id: string;
  store_id: string;
  category_id: string;
  expires_at: string;
  changes: BulkEditChanges;
  variants: readonly BulkEditVariant[];
}>;
