export type SimilarPublicationSourceType = 'LEGACY' | 'USER_PRODUCT';

export type SimilarPublicationAttributeValue = {
  id: string | null;
  name: string | null;
};

export type SimilarPublicationAttributeOption =
  SimilarPublicationAttributeValue & {
    colorHex: string | null;
  };

export type SimilarPublicationAttributeRole =
  'MAIN' | 'VARIANT' | 'IDENTIFIER' | 'SIZE' | 'COLOR' | 'OTHER';

export type SimilarPublicationAttributeInputType =
  'TEXT' | 'NUMBER' | 'SELECT' | 'TAGS';

export type SimilarPublicationAttribute = {
  id: string;
  name: string | null;
  valueId: string | null;
  valueName: string | null;
  values: SimilarPublicationAttributeValue[];
  required?: boolean;
  editable?: boolean;
  inputType?: SimilarPublicationAttributeInputType;
  role?: SimilarPublicationAttributeRole;
  options?: SimilarPublicationAttributeOption[];
  display?: { colorHex: string | null };
};

export type SimilarPublicationChoice = {
  id: string;
  name: string | null;
};

export type SimilarPublicationCondition = SimilarPublicationChoice;

export type SimilarPublicationSizeGuide = SimilarPublicationChoice & {
  selected: boolean;
};

export type SimilarPublicationPackage = {
  hasFactoryPackaging: boolean | null;
  widthCm: number | null;
  heightCm: number | null;
  lengthCm: number | null;
  weightKg: number | null;
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
  variantAttributes?: SimilarPublicationAttribute[];
  sizeAttribute?: SimilarPublicationAttribute | null;
  colorAttribute?: SimilarPublicationAttribute | null;
  pictureIds: string[];
};

export type SimilarPublicationDraft = {
  sourceKey: string;
  sourceType: SimilarPublicationSourceType;
  categoryId: string | null;
  categoryName?: string | null;
  familyName: string | null;
  titleTemplate: string | null;
  description: string | null;
  currencyId: string | null;
  listingTypeId: string | null;
  listingType?: SimilarPublicationChoice | null;
  listingTypeOptions?: SimilarPublicationChoice[];
  buyingMode: string | null;
  ui?: { showBuyingMode: boolean };
  condition?: SimilarPublicationCondition | null;
  conditionOptions?: SimilarPublicationCondition[];
  saleTerms: SimilarPublicationSaleTerm[];
  shipping: { freeShipping: boolean } | null;
  channels: string[];
  commonAttributes?: SimilarPublicationAttribute[];
  mainAttributes?: SimilarPublicationAttribute[];
  sizeGuide?: SimilarPublicationSizeGuide | null;
  sizeGuideOptions?: SimilarPublicationSizeGuide[];
  package?: SimilarPublicationPackage;
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
  condition?: SimilarPublicationCondition | null;
  package?: SimilarPublicationPackage;
  pictures?: string[];
  variants: Array<
    Omit<SimilarPublicationVariant, 'sku' | 'price' | 'stock'> & {
      price: number;
      stock: number;
      sku: string | null;
    }
  >;
};

export type SimilarPublicationErrorCause = {
  code: string | null;
  message: string | null;
  department: string | null;
};

export type SimilarPublicationCreatedItem = {
  variantKey: string;
  status: 'CREATED' | 'ERROR';
  itemId: string | null;
  userProductId: string | null;
  familyId: string | null;
  error: {
    message: string;
    errorCode?: string;
    causes?: SimilarPublicationErrorCause[];
  } | null;
};

export type SimilarPublicationCreationResult = {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  items: SimilarPublicationCreatedItem[];
  sourceKey: string | null;
  newSourceKey: string | null;
};

export type SimilarPublicationPackageAttributeIds = {
  hasFactoryPackaging: string | null;
  width: string | null;
  height: string | null;
  length: string | null;
  weight: string | null;
};

export type SimilarPublicationCreationCategoryRules = {
  packageAttributeIds: SimilarPublicationPackageAttributeIds;
};

export type SimilarPublicationPictureUpload = {
  id: string;
  secureUrl: string;
};

export type SimilarPublicationBase64PictureInput = {
  fileName: string;
  mimeType: string;
  base64: string;
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
