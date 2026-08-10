import { Database } from '../database.types';

type Tables = Database['public']['Tables'];

export type MercadolibreProductRow = Tables['mercadolibre_products']['Row'];
export type MercadolibreProductUpsert =
  Tables['mercadolibre_products']['Insert'];
export type MercadolibreChildRow =
  Tables['mercadolibre_product_children']['Row'];
export type MercadolibreChildUpsert =
  Tables['mercadolibre_product_children']['Insert'];

export type MercadolibreProductListRow = Pick<
  MercadolibreProductRow,
  | 'id'
  | 'seller_id'
  | 'external_key'
  | 'model'
  | 'family_id'
  | 'parent_item_id'
  | 'family_name'
  | 'title'
  | 'thumbnail'
  | 'status'
  | 'category_id'
  | 'currency_id'
  | 'price_from'
  | 'price_to'
  | 'stock_total'
  | 'children_count'
  | 'permalink'
  | 'source_updated_at'
  | 'last_synced_at'
  | 'updated_at'
>;

export type MercadolibreProductDetail = Omit<
  MercadolibreProductRow,
  'last_full_sync_id'
>;

export type ProductsPage = {
  products: MercadolibreProductListRow[];
  total: number;
};
