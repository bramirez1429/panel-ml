export type SimilarPublicationSourceType = 'LEGACY' | 'USER_PRODUCT';

export type SimilarPublicationAttributeValue = {
  id: string | null;
  name: string | null;
};

export type SimilarPublicationAttribute = {
  id: string;
  name: string | null;
  valueId: string | null;
  valueName: string | null;
  values: SimilarPublicationAttributeValue[];
};

export type SimilarPublicationSaleTerm = {
  id: string;
  valueId: string | null;
  valueName: string | null;
};

export type SimilarPublicationVariant = {
  sourceReference: string;
  price: number | null;
  stock: number | null;
  sku: null;
  attributes: SimilarPublicationAttribute[];
  pictureIds: string[];
};

export type SimilarPublicationDraft = {
  sourceKey: string;
  sourceType: SimilarPublicationSourceType;
  categoryId: string | null;
  familyName: string | null;
  titleTemplate: string | null;
  description: string | null;
  currencyId: string | null;
  listingTypeId: string | null;
  buyingMode: string | null;
  saleTerms: SimilarPublicationSaleTerm[];
  shipping: { freeShipping: boolean } | null;
  channels: string[];
  variants: SimilarPublicationVariant[];
  pictures: [];
};

export type SimilarPublicationCreateInput = Omit<
  SimilarPublicationDraft,
  | 'sourceType'
  | 'pictures'
  | 'variants'
  | 'categoryId'
  | 'currencyId'
  | 'listingTypeId'
  | 'buyingMode'
> & {
  categoryId: string;
  currencyId: string;
  listingTypeId: string;
  buyingMode: string;
  pictures?: string[];
  variants: Array<
    Omit<SimilarPublicationVariant, 'sku' | 'price' | 'stock'> & {
      price: number;
      stock: number;
      sku: string | null;
    }
  >;
};

export type SimilarPublicationCreatedItem = {
  variantKey: string;
  status: 'CREATED' | 'ERROR';
  itemId: string | null;
  userProductId: string | null;
  familyId: string | null;
  error: { message: string; errorCode?: string } | null;
};

export type SimilarPublicationCreationResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  items: SimilarPublicationCreatedItem[];
  sourceKey: string | null;
};

export type SimilarPublicationPictureUpload = {
  id: string;
  secureUrl: string;
};

export type SimilarPublicationSourceContext = {
  sellerId: number;
  accessToken: string;
  draft: SimilarPublicationDraft;
  originalIdentifierValues: Set<string>;
  originalPictureIds: Set<string>;
};

export type SimilarPublicationUploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};
