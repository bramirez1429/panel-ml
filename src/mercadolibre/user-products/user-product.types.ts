export type MercadoLibreUserProduct = Record<string, unknown> & {
  id: string;
  family_id?: unknown;
  name?: unknown;
};

export type UserProductFamily = {
  familyId: string;
  siteId: string;
  userId: number;
  userProductIds: string[];
};

export type ResolvedUserProductFamily = {
  userProductId: string;
  userProductName: string | null;
  familyId: string;
  userId: number;
  userProductIds: string[];
};

export type UserProductFamilyCache = {
  userProducts: Map<string, Promise<MercadoLibreUserProduct>>;
  families: Map<string, Promise<UserProductFamily>>;
  familyByUserProduct: Map<string, Promise<UserProductFamily>>;
};
