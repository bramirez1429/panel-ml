export type JsonObject = Record<string, unknown>;

export type MercadoLibrePublication = JsonObject & {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  thumbnail?: unknown;
  price?: unknown;
  family_name?: unknown;
  user_product_id?: unknown;
  tags?: unknown;
  variations?: unknown;
};

export type PublicationError = {
  id: string;
  code: number;
  body: unknown;
};

export type PublicationDetails = {
  publications: MercadoLibrePublication[];
  errors: PublicationError[];
};

export type PublicationParent = {
  id: string;
  title: string | null;
  status: string | null;
  thumbnail: string | null;
  price: number | null;
};

export type FamilyParent = {
  familyId: string;
  title: string | null;
};

export type PublicationChild = {
  id: string;
  userProductId: string;
  title: string | null;
  status: string | null;
  price: number | null;
};

export type SharedPublicationRow = {
  type: 'SHARED';
  parent: PublicationParent;
  children: [];
};

export type VariantPricingPublicationRow = {
  type: 'VARIANT_PRICING';
  parent: FamilyParent;
  children: PublicationChild[];
};

export type PublicationRow =
  SharedPublicationRow | VariantPricingPublicationRow;

export type PublicationModel = PublicationRow['type'];

export type PublicationPage = {
  paging: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  totalItems: number;
  count: number;
  publications: PublicationRow[];
  errors: PublicationError[];
};
