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
  workspace_id: string | null;
  seller_id: number;
  nickname: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
};

type TokenInsert = Omit<TokenRow, 'workspace_id'> & {
  workspace_id?: string | null;
};

type WorkspaceRole = 'OWNER' | 'MEMBER';

type WorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type WorkspaceInsert = {
  id?: string;
  slug: string;
  name: string;
  created_at?: string;
  updated_at?: string;
};

type WorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
};

type WorkspaceMemberInsert = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at?: string;
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
  workspace_id: string | null;
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
  workspace_id?: string | null;
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
  workspace_id: string | null;
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
  workspace_id?: string | null;
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
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
  created_at: string;
  updated_at: string;
};

type UserInsert = {
  id?: string;
  email: string;
  password_hash: string;
  name?: string | null;
  is_active?: boolean;
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
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
  sold_total: number;
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
  sold_total?: number;
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

type SyncJobStatus =
  'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';

type SyncJobRow = {
  id: string;
  seller_id: number;
  full_sync_id: string;
  status: SyncJobStatus;
  scan_started: boolean;
  scroll_id: string | null;
  buffer_item_ids: Json;
  total_items: number;
  processed_items: number;
  successful_items: number;
  failed_items: number;
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
  total_items?: number;
  processed_items?: number;
  successful_items?: number;
  failed_items?: number;
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

export type SyncErrorType =
  | 'PUBLICATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'PROVIDER_TEMPORARY_ERROR'
  | 'POSSIBLE_API_CHANGE'
  | 'MIRROR_WRITE_FAILED';

export type SyncErrorStatus = 'OPEN' | 'RETRYING' | 'RESOLVED';

export type SyncErrorRow = {
  id: string;
  sync_job_id: string | null;
  seller_id: number;
  item_id: string;
  family_id: string | null;
  error_type: SyncErrorType;
  error_code: string | null;
  error_message: string;
  attempts: number;
  status: SyncErrorStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type SyncErrorInsert = {
  id?: string;
  sync_job_id?: string | null;
  seller_id: number;
  item_id: string;
  family_id?: string | null;
  error_type: SyncErrorType;
  error_code?: string | null;
  error_message: string;
  attempts?: number;
  status?: SyncErrorStatus;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
};

export type IntegrationEventType =
  | 'POSSIBLE_API_CHANGE'
  | 'SCHEMA_MISMATCH'
  | 'UNKNOWN_PROVIDER_ERROR'
  | 'PROVIDER_BEHAVIOR_CHANGE';

export type IntegrationEventStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export type IntegrationEventRow = {
  id: string;
  seller_id: number | null;
  event_type: IntegrationEventType;
  endpoint: string;
  http_method: string | null;
  http_status: number | null;
  provider_code: string | null;
  message: string;
  fingerprint: string;
  occurrences: number;
  status: IntegrationEventStatus;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  metadata: Json | null;
};

export type IntegrationEventInsert = {
  id?: string;
  seller_id?: number | null;
  event_type: IntegrationEventType;
  endpoint: string;
  http_method?: string | null;
  http_status?: number | null;
  provider_code?: string | null;
  message: string;
  fingerprint: string;
  occurrences?: number;
  status?: IntegrationEventStatus;
  first_seen_at?: string;
  last_seen_at?: string;
  resolved_at?: string | null;
  metadata?: Json | null;
};

type PromotionBulkJobStatus =
  'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS';

type PromotionBulkJobRow = {
  id: string;
  user_id: string;
  seller_id: number;
  status: PromotionBulkJobStatus;
  total_items: number;
  processed_items: number;
  successful_items: number;
  failed_items: number;
  locked_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type PromotionBulkJobInsert = {
  id?: string;
  user_id: string;
  seller_id: number;
  status?: PromotionBulkJobStatus;
  total_items: number;
  processed_items?: number;
  successful_items?: number;
  failed_items?: number;
  locked_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type PromotionBulkItemStatus =
  'QUEUED' | 'PROCESSING' | 'SCHEDULED' | 'ACTIVE' | 'ERROR';

type PromotionBulkJobItemRow = {
  id: string;
  job_id: string;
  position: number;
  item_id: string;
  request: Json;
  status: PromotionBulkItemStatus;
  error_code: string | null;
  provider_message: string | null;
  processing_started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type PromotionBulkJobItemInsert = {
  id?: string;
  job_id: string;
  position: number;
  item_id: string;
  request: Json;
  status?: PromotionBulkItemStatus;
  error_code?: string | null;
  provider_message?: string | null;
  processing_started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type RecentSaleChannel = 'MERCADOLIBRE' | 'TIENDANUBE';
export type SaleMappingStatus =
  'LINKED' | 'AUTO_LINKED' | 'UNLINKED' | 'AMBIGUOUS';

export type RecentSaleRow = {
  id: string;
  user_id: string;
  channel: RecentSaleChannel;
  external_order_id: string;
  external_order_item_id: string;
  sold_at: string;
  quantity: number;
  product_name: string;
  sku: string | null;
  ml_item_id: string | null;
  ml_variation_id: string | null;
  user_product_id: string | null;
  family_id: string | null;
  tn_product_id: string | null;
  tn_variant_id: string | null;
  color: string | null;
  size: string | null;
  mapping_status: SaleMappingStatus;
  created_at: string;
  updated_at: string;
};

export type RecentSaleInsert = Omit<
  RecentSaleRow,
  'id' | 'created_at' | 'updated_at'
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type VariantChannelLinkRow = {
  id: string;
  user_id: string;
  ml_item_id: string;
  ml_variation_id: string | null;
  user_product_id: string | null;
  family_id: string | null;
  tn_product_id: string;
  tn_variant_id: string;
  sku: string | null;
  normalized_color: string | null;
  normalized_size: string | null;
  match_source: 'MANUAL' | 'SKU' | 'ATTRIBUTES';
  created_at: string;
  updated_at: string;
};

export type VariantChannelLinkInsert = Omit<
  VariantChannelLinkRow,
  'id' | 'created_at' | 'updated_at'
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type Database = {
  public: {
    Tables: {
      users: Table<UserRow, UserInsert>;
      workspaces: Table<WorkspaceRow, WorkspaceInsert>;
      workspace_members: Table<
        WorkspaceMemberRow,
        WorkspaceMemberInsert,
        [
          {
            foreignKeyName: 'workspace_members_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'workspace_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ]
      >;
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
        TokenInsert,
        [
          {
            foreignKeyName: 'mercadolibre_tokens_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mercadolibre_tokens_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
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
          {
            foreignKeyName: 'tiendanube_connections_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
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
            foreignKeyName: 'tiendanube_product_links_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
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
      mercadolibre_sync_errors: Table<
        SyncErrorRow,
        SyncErrorInsert,
        [
          {
            foreignKeyName: 'mercadolibre_sync_errors_sync_job_id_fkey';
            columns: ['sync_job_id'];
            isOneToOne: false;
            referencedRelation: 'mercadolibre_sync_jobs';
            referencedColumns: ['id'];
          },
        ]
      >;
      mercadolibre_integration_events: Table<
        IntegrationEventRow,
        IntegrationEventInsert
      >;
      mercadolibre_promotion_bulk_jobs: Table<
        PromotionBulkJobRow,
        PromotionBulkJobInsert
      >;
      mercadolibre_promotion_bulk_job_items: Table<
        PromotionBulkJobItemRow,
        PromotionBulkJobItemInsert
      >;
      recent_sales: Table<RecentSaleRow, RecentSaleInsert>;
      variant_channel_links: Table<
        VariantChannelLinkRow,
        VariantChannelLinkInsert
      >;
    };
    Views: Record<string, never>;
    Functions: {
      record_mercadolibre_integration_event: {
        Args: {
          p_seller_id: number | null;
          p_event_type: IntegrationEventType;
          p_endpoint: string;
          p_http_method: string | null;
          p_http_status: number | null;
          p_provider_code: string | null;
          p_message: string;
          p_fingerprint: string;
          p_metadata: Json | null;
        };
        Returns: string;
      };
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
      create_mercadolibre_promotion_bulk_job: {
        Args: {
          p_job_id: string;
          p_user_id: string;
          p_seller_id: number;
          p_items: Json;
        };
        Returns: string;
      };
      claim_mercadolibre_promotion_bulk_job: {
        Args: {
          p_job_id: string;
          p_stale_before: string;
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
      reserve_tiendanube_product_link_by_source: {
        Args: {
          p_user_id: string;
          p_store_id: string;
          p_ml_source_key: string;
        };
        Returns: ReserveTiendanubeProductLinkResult[];
      };
      complete_tiendanube_product_link_by_source: {
        Args: {
          p_link_id: string;
          p_user_id: string;
          p_store_id: string;
          p_ml_source_key: string;
          p_reservation_version: string;
          p_tiendanube_product_id: string;
        };
        Returns: boolean;
      };
      fail_tiendanube_product_link_by_source: {
        Args: {
          p_link_id: string;
          p_user_id: string;
          p_store_id: string;
          p_ml_source_key: string;
          p_reservation_version: string;
        };
        Returns: boolean;
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
