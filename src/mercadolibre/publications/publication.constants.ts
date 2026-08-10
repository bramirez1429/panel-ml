/** Tamaño máximo permitido por el scan de publicaciones. */
export const PUBLICATION_SCAN_SIZE = 100;

/** Cantidad máxima de publicaciones aceptada por multiget. */
export const PUBLICATION_MULTIGET_SIZE = 20;

/** Cantidad máxima de lotes consultados al mismo tiempo. */
export const PUBLICATION_REQUEST_CONCURRENCY = 4;

/** Tamaño de página para buscar ítems asociados a User Products. */
export const USER_PRODUCT_ITEM_SEARCH_SIZE = 50;

/** Cantidad de MLAU incluida en cada filtro de b\u00fasqueda. */
export const USER_PRODUCT_FILTER_BATCH_SIZE = 20;

/** Campos necesarios para sincronizar y normalizar publicaciones. */
export const PUBLICATION_SYNC_ATTRIBUTES = [
  'id',
  'title',
  'family_name',
  'user_product_id',
  'variations',
  'tags',
  'status',
  'price',
  'currency_id',
  'available_quantity',
  'sold_quantity',
  'thumbnail',
  'category_id',
  'permalink',
  'listing_type_id',
  'last_updated',
  'attributes',
  'site_id',
  'seller_id',
] as const;
