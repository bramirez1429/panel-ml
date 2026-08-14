export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert, Relationships extends readonly unknown[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: Relationships;
};

type TokenRow = {
  seller_id: number;
  nickname: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
};

type ProductRow = {
  id: string;
  seller_id: number;
  external_key: string;
  model: 'SHARED' | 'VARIANT_PRICING';
  family_id: string | null;
  parent_item_id: string | null;
  family_name: string | null;
  title: string;
  thumbnail: string | null;
  status: string | null;
  category_id: string | null;
  currency_id: string | null;
  price_from: number | null;
  price_to: number | null;
  stock_total: number;
  children_count: number;
  permalink: string | null;
  shared_variations: Json;
  pictures: Json;
  shared_skus: Json;
  management_synced_at: string | null;
  source_updated_at: string | null;
  last_synced_at: string;
  last_full_sync_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProductInsert = {
  id?: string;
  seller_id: number;
  external_key: string;
  model: ProductRow['model'];
  family_id?: string | null;
  parent_item_id?: string | null;
  family_name?: string | null;
  title: string;
  thumbnail?: string | null;
  status?: string | null;
  category_id?: string | null;
  currency_id?: string | null;
  price_from?: number | null;
  price_to?: number | null;
  stock_total?: number;
  children_count?: number;
  permalink?: string | null;
  shared_variations?: Json;
  pictures?: Json;
  shared_skus?: Json;
  management_synced_at?: string | null;
  source_updated_at?: string | null;
  last_synced_at?: string;
  last_full_sync_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

type ChildRow = {
  id: string;
  product_id: string;
  item_id: string;
  user_product_id: string;
  variant_label: string | null;
  title: string | null;
  thumbnail: string | null;
  status: string | null;
  currency_id: string | null;
  listing_type_id: string | null;
  price: number | null;
  available_quantity: number;
  sold_quantity: number;
  attributes: Json;
  pictures: Json;
  management_synced_at: string | null;
  permalink: string | null;
  source_updated_at: string | null;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

type ChildInsert = {
  id?: string;
  product_id: string;
  item_id: string;
  user_product_id: string;
  variant_label?: string | null;
  title?: string | null;
  thumbnail?: string | null;
  status?: string | null;
  currency_id?: string | null;
  listing_type_id?: string | null;
  price?: number | null;
  available_quantity?: number;
  sold_quantity?: number;
  attributes?: Json;
  pictures?: Json;
  management_synced_at?: string | null;
  permalink?: string | null;
  source_updated_at?: string | null;
  last_synced_at?: string;
  created_at?: string;
  updated_at?: string;
};

type SyncJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

type SyncJobRow = {
  id: string;
  seller_id: number;
  full_sync_id: string;
  status: SyncJobStatus;
  scan_started: boolean;
  scroll_id: string | null;
  buffer_item_ids: Json;
  processed_items: number;
  products_saved: number;
  children_saved: number;
  errors_count: number;
  retry_count: number;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type SyncJobInsert = {
  id?: string;
  seller_id: number;
  full_sync_id: string;
  status?: SyncJobStatus;
  scan_started?: boolean;
  scroll_id?: string | null;
  buffer_item_ids?: Json;
  processed_items?: number;
  products_saved?: number;
  children_saved?: number;
  errors_count?: number;
  retry_count?: number;
  last_error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type PublicationActionStatus = 'SUCCESS' | 'FAILED';

type PublicationActionRow = {
  id: string;
  seller_id: number;
  product_id: string;
  item_id: string | null;
  action:
    | 'PRICE_UPDATED'
    | 'STOCK_UPDATED'
    | 'SKU_UPDATED'
    | 'PICTURES_UPDATED'
    | 'PAUSED'
    | 'ACTIVATED'
    | 'TITLE_UPDATED'
    | 'DESCRIPTION_UPDATED'
    | 'ATTRIBUTES_UPDATED'
    | 'PROMOTION_APPLIED'
    | 'PROMOTION_REMOVED'
    | 'PUBLISHED';
  status: PublicationActionStatus;
  old_value: Json | null;
  new_value: Json | null;
  error_message: string | null;
  created_at: string;
};

type PublicationActionInsert = {
  id?: string;
  seller_id: number;
  product_id: string;
  item_id?: string | null;
  action: PublicationActionRow['action'];
  status: PublicationActionStatus;
  old_value?: Json | null;
  new_value?: Json | null;
  error_message?: string | null;
  created_at?: string;
};

export type Database = {
  public: {
    Tables: {
      mercadolibre_tokens: Table<TokenRow, TokenRow>;
      mercadolibre_products: Table<ProductRow, ProductInsert>;
      mercadolibre_product_children: Table<
        ChildRow,
        ChildInsert,
        [
          {
            foreignKeyName: 'mercadolibre_product_children_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'mercadolibre_products';
            referencedColumns: ['id'];
          },
        ]
      >;
      mercadolibre_sync_jobs: Table<SyncJobRow, SyncJobInsert>;
      mercadolibre_publication_actions: Table<
        PublicationActionRow,
        PublicationActionInsert,
        [
          {
            foreignKeyName: 'mercadolibre_publication_actions_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'mercadolibre_products';
            referencedColumns: ['id'];
          },
        ]
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
