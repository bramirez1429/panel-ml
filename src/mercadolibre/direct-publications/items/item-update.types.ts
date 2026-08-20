export type EditableItemStatus =
  | 'active'
  | 'paused'
  | 'closed';

export type EditableAttributeValue = {
  id?: string | null;
  name?: string | null;
};

export type EditableAttribute = {
  id: string;
  value_id?: string | null;
  value_name?: string | null;
  values?: EditableAttributeValue[];
};

export type EditablePicture = {
  id?: string;
  source?: string;
};

export type EditableSaleTerm = {
  id: string;
  value_id?: string | null;
  value_name?: string | null;
};

/**
 * Publicación versión clásica / SHARED.
 */
export type ClassicItemUpdate = {
  title?: string;

  price?: number;
  available_quantity?: number;

  status?: EditableItemStatus;

  pictures?: EditablePicture[];
  video_id?: string | null;

  attributes?: EditableAttribute[];

  shipping?: {
    free_shipping?: boolean;
    local_pick_up?: boolean;
  };

  sale_terms?: EditableSaleTerm[];

  listing_type_id?: string;

  category_id?: string;
  currency_id?: string;
};

/**
 * Condición de venta de una publicación nueva.
 *
 * NO ponemos aquí:
 * - title
 * - family_name
 * - pictures
 * - attributes
 * - available_quantity
 *
 * porque en VARIANT_PRICING tienen otro flujo.
 */
export type VariantPricingItemUpdate = {
  price?: number;

  status?: EditableItemStatus;

  shipping?: {
    free_shipping?: boolean;
  };

  sale_terms?: EditableSaleTerm[];

  listing_type_id?: string;

  catalog_listing?: boolean;

  channels?: string[];

  tags?: string[];

  category_id?: string;

  currency_id?: string;

  catalog_product_id?: string | null;

  buying_mode?: string;

  official_store_id?: number | null;
};