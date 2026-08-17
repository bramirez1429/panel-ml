export type FamilyResponse = {
  user_products_ids: string[];
  family_id: number;
  site_id: string;
  user_id: number;
};

export type SearchResponse = {
  seller_id: string | number;
  results: string[];
  paging: {
    limit: number;
    offset: number;
    total: number;
  };
};

export type Attribute = {
  id: string;
  name?: string;
  value_name?: string | null;
  values?: Array<{
    id?: string | null;
    name?: string | null;
  }>;
};

export type Picture = {
  id: string;
  url?: string;
  secure_url?: string;
};

export type MercadoLibreItem = {
  id: string;
  title?: string;

  site_id?: string;
  seller_id?: number;

  family_name?: string | null;
  family_id?: number | null;
  user_product_id?: string | null;

  category_id?: string;
  domain_id?: string;

  price?: number;
  base_price?: number;
  original_price?: number | null;
  currency_id?: string;

  initial_quantity?: number;
  available_quantity?: number;
  sold_quantity?: number;

  seller_custom_field?: string | null;
  inventory_id?: string | null;

  status?: string;
  sub_status?: string[];
  condition?: string;

  permalink?: string;
  thumbnail?: string;
  pictures?: Picture[];

  attributes?: Attribute[];

  shipping?: {
    mode?: string;
    free_shipping?: boolean;
    logistic_type?: string;
    local_pick_up?: boolean;
    store_pick_up?: boolean;
    tags?: string[];
  };

  listing_type_id?: string;

  channels?: string[];
  tags?: string[];
  sale_terms?: unknown[];

  warranty?: string | null;

  catalog_product_id?: string | null;
  health?: number | null;

  date_created?: string;
  last_updated?: string;
};

export type MultiGetResponse = {
  code: number;
  body: MercadoLibreItem;
};

export type PriceNode = {
  id?: string;
  type?: 'standard' | 'promotion' | string;
  amount?: number;
  regular_amount?: number | null;
  currency_id?: string;

  last_updated?: string;

  conditions?: {
    context_restrictions?: string[];
    start_time?: string | null;
    end_time?: string | null;
  };
};

export type PricesResponse = {
  id: string;
  prices?: PriceNode[];
};

export type SalePriceResponse = {
  price_id?: string;
  amount?: number | null;
  regular_amount?: number | null;
  currency_id?: string;
  reference_date?: string;

  metadata?: Record<string, unknown>;
};

export type Promotion = {
  id?: string;
  type?: string;
  sub_type?: string;

  status?: string;

  price?: number;
  original_price?: number;

  start_date?: string;
  finish_date?: string;

  name?: string;

  [key: string]: unknown;
};