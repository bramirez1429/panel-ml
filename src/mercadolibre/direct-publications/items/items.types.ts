export type MlAttribute = {
  id: string;
  name?: string;
  value_name?: string | null;
  values?: Array<{
    id?: string | null;
    name?: string | null;
  }>;
};

export type MlPicture = {
  id: string;
  url?: string;
  secure_url?: string;
};

export type MlItem = {
  id: string;
  title?: string;

  family_name?: string | null;
  family_id?: number | string | null;
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

  inventory_id?: string | null;
  seller_custom_field?: string | null;

  status?: string;
  sub_status?: string[];
  condition?: string;

  permalink?: string;
  thumbnail?: string;
  pictures?: MlPicture[];

  variations?: unknown[];
  attributes?: MlAttribute[];

  tags?: string[];
  channels?: string[];

  listing_type_id?: string;

  shipping?: {
    mode?: string;
    free_shipping?: boolean;
    logistic_type?: string;
    local_pick_up?: boolean;
    store_pick_up?: boolean;
    tags?: string[];
  };

  sale_terms?: unknown[];

  warranty?: string | null;
  catalog_product_id?: string | null;
  health?: number | null;

  date_created?: string;
  last_updated?: string;
};

export type MlMultiGetResponse = {
  code: number;
  body: MlItem;
};
