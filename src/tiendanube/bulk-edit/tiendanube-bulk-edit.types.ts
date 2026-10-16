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

export type BulkEditJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'PAUSED';
export type BulkEditItemStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';

export type BulkEditJob = Readonly<{
  id: string; user_id: string; store_id: string; category_id: string;
  status: BulkEditJobStatus; total_products: number; total_variants: number;
  completed_variants: number; failed_variants: number; started_at: string | null;
  finished_at: string | null; execution_token: string; lease_expires_at: string | null;
  error_message: string | null; created_at: string; updated_at: string;
  requested_changes: BulkEditChanges;
}>;

export type BulkEditItem = Readonly<{
  id: string; job_id: string; product_id: string; product_name: string; variant_id: string;
  sku: string | null; requested_changes: BulkEditChanges; status: BulkEditItemStatus;
  attempts: number; error_code: string | null; error_message: string | null;
  updated_at: string;
}>;
