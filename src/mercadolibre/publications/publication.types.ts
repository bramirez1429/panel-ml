import type {
  MercadolibreChildUpsert,
  MercadolibreProductUpsert,
} from '../../database/repositories/mercadolibre-publications.types';

export type JsonObject = Record<string, unknown>;

export type MercadoLibrePublication = JsonObject & {
  id?: unknown;
  title?: unknown;
  family_name?: unknown;
  user_product_id?: unknown;
  variations?: unknown;
  tags?: unknown;
  status?: unknown;
  price?: unknown;
  currency_id?: unknown;
  available_quantity?: unknown;
  sold_quantity?: unknown;
  thumbnail?: unknown;
  category_id?: unknown;
  permalink?: unknown;
  listing_type_id?: unknown;
  last_updated?: unknown;
  attributes?: unknown;
  site_id?: unknown;
  seller_id?: unknown;
};

export type PublicationSourceError = {
  itemId: string;
  status: number;
  body: unknown;
};

export type PublicationSourceResult = {
  publications: MercadoLibrePublication[];
  errors: PublicationSourceError[];
};

export type ReducedAttribute = {
  id: string;
  valueName: string | null;
};

export type SharedVariation = {
  id: string;
  label: string;
  availableQuantity: number;
  soldQuantity: number;
  attributes: ReducedAttribute[];
};

export type NormalizationContext = {
  sellerId: number;
  syncedAt: string;
};

export type ResolvedVariantPublication = {
  publication: MercadoLibrePublication;
  familyId: string;
  userProductId: string;
  userProductName: string | null;
};

export type NormalizedPublicationBundle = {
  parent: MercadolibreProductUpsert;
  children: Array<Omit<MercadolibreChildUpsert, 'product_id'>>;
};

export type PublicationModel = 'SHARED' | 'VARIANT_PRICING';
