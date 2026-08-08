export type UserProductReferenceSource = {
  user_product_id?: unknown;
  variations?: unknown;
};

export type MercadoLibreUserProduct = Record<string, unknown> & {
  id: string;
};

export type UserProductMetadata = {
  id: string;
  familyId: string;
  name: string | null;
};
