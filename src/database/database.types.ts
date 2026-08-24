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
  user_id: string;
  seller_id: number;
  nickname: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
};

type MercadoLibreOAuthTransactionRow = {
  state_hash: string;
  user_id: string;
  refresh_session_id: string;
  browser_binding_hash: string;
  expires_at: string;
  created_at: string;
};

type MercadoLibreOAuthTransactionInsert = Omit<
  MercadoLibreOAuthTransactionRow,
  'created_at'
> & {
  created_at?: string;
};

type TiendanubeConnectionRow = {
  id: string;
  user_id: string;
  store_id: string;
  access_token: string;
  token_type: string;
  scope: string;
  connected_at: string;
  updated_at: string;
};

type TiendanubeConnectionInsert = {
  id?: string;
  user_id: string;
  store_id: string;
  access_token: string;
  token_type: string;
  scope: string;
  connected_at?: string;
  updated_at?: string;
};

type TiendanubeProductLinkStatus = 'PENDING' | 'FAILED' | 'COMPLETED';

type TiendanubeProductLinkRow = {
  id: string;
  user_id: string;
  store_id: string;
  ml_product_id: string | null;
  ml_source_key: string;
  tiendanube_product_id: string | null;
  status: TiendanubeProductLinkStatus;
  created_at: string;
  updated_at: string;
};

type TiendanubeProductLinkInsert = {
  id?: string;
  user_id: string;
  store_id: string;
  ml_product_id?: string | null;
  ml_source_key: string;
  tiendanube_product_id?: string | null;
  status?: TiendanubeProductLinkStatus;
  created_at?: string;
  updated_at?: string;
};

type ReserveTiendanubeProductLinkResult = {
  outcome: 'RESERVED' | 'PENDING' | 'COMPLETED';
  link_id: string;
  link_status: TiendanubeProductLinkStatus;
  tiendanube_product_id: string | null;
  reservation_version: string | null;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type UserInsert = {
  id?: string;
  email: string;
  password_hash: string;
  name?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

type UserRefreshSessionRow = {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  rotated_at: string;
};

type UserRefreshSessionInsert = {
  id?: string;
  user_id: string;
  refresh_token_hash: string;
  expires_at: string;
  revoked_at?: string | null;
  created_at?: string;
  rotated_at?: string;
};

type UserRefreshSessionMetadataRow = Omit<
  UserRefreshSessionRow,
  'refresh_token_hash'
>;

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

export type Database = {
  public: {
    Tables: {
      users: Table<UserRow, UserInsert>;
      user_refresh_sessions: Table<
        UserRefreshSessionRow,
        UserRefreshSessionInsert,
        [
          {
            foreignKeyName: 'user_refresh_sessions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ]
      >;
      mercadolibre_tokens: Table<
        TokenRow,
        TokenRow,
        [
          {
            foreignKeyName: 'mercadolibre_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ]
      >;
      mercadolibre_oauth_transactions: Table<
        MercadoLibreOAuthTransactionRow,
        MercadoLibreOAuthTransactionInsert,
        [
          {
            foreignKeyName: 'mercadolibre_oauth_transactions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mercadolibre_oauth_transactions_refresh_session_id_fkey';
            columns: ['refresh_session_id'];
            isOneToOne: false;
            referencedRelation: 'user_refresh_sessions';
            referencedColumns: ['id'];
          },
        ]
      >;
      tiendanube_connections: Table<
        TiendanubeConnectionRow,
        TiendanubeConnectionInsert,
        [
          {
            foreignKeyName: 'tiendanube_connections_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ]
      >;
      tiendanube_product_links: Table<
        TiendanubeProductLinkRow,
        TiendanubeProductLinkInsert,
        [
          {
            foreignKeyName: 'tiendanube_product_links_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tiendanube_product_links_ml_product_id_fkey';
            columns: ['ml_product_id'];
            isOneToOne: false;
            referencedRelation: 'mercadolibre_products';
            referencedColumns: ['id'];
          },
        ]
      >;
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
    };
    Views: Record<string, never>;
    Functions: {
      create_user_refresh_session: {
        Args: {
          p_user_id: string;
          p_refresh_token_hash: string;
          p_ttl_milliseconds: number;
        };
        Returns: UserRefreshSessionMetadataRow[];
      };
      rotate_user_refresh_session: {
        Args: {
          p_current_refresh_token_hash: string;
          p_next_refresh_token_hash: string;
        };
        Returns: UserRefreshSessionMetadataRow[];
      };
      create_mercadolibre_oauth_transaction: {
        Args: {
          p_state_hash: string;
          p_user_id: string;
          p_refresh_session_id: string;
          p_browser_binding_hash: string;
          p_expires_at: string;
        };
        Returns: boolean;
      };
      consume_mercadolibre_oauth_transaction: {
        Args: {
          p_state_hash: string;
          p_user_id: string;
          p_browser_binding_hash: string;
        };
        Returns: boolean;
      };
      reserve_tiendanube_product_link: {
        Args: {
          p_user_id: string;
          p_store_id: string;
          p_ml_product_id: string;
          p_ml_source_key: string;
        };
        Returns: ReserveTiendanubeProductLinkResult[];
      };
      complete_tiendanube_product_link: {
        Args: {
          p_link_id: string;
          p_user_id: string;
          p_store_id: string;
          p_ml_product_id: string;
          p_ml_source_key: string;
          p_reservation_version: string;
          p_tiendanube_product_id: string;
        };
        Returns: boolean;
      };
      fail_tiendanube_product_link: {
        Args: {
          p_link_id: string;
          p_user_id: string;
          p_store_id: string;
          p_ml_product_id: string;
          p_ml_source_key: string;
          p_reservation_version: string;
        };
        Returns: boolean;
      };
    };
  };
};
