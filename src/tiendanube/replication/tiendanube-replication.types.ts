export type ReplicableProductAttribute = Readonly<{
  id: string;
  name: string;
}>;

export type ReplicableProductVariantValue = Readonly<{
  attributeId: string;
  value: string;
}>;

export type ReplicableProductVariant = Readonly<{
  price: number;
  stock: number;
  sku: string | null;
  imageSrc?: string;
  weight?: number | null;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  values: readonly ReplicableProductVariantValue[];
}>;

export type ReplicableProduct = Readonly<{
  title: string;
  description: string | null;
  images: readonly string[];
  attributes: readonly ReplicableProductAttribute[];
  variants: readonly ReplicableProductVariant[];
  brand?: string | null;
  categoryIds?: readonly number[];
  tags?: readonly string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
}>;

export type TiendanubeLocalizedValueDto = Readonly<{
  es: string;
}>;

export type TiendanubeCreateProductVariantDto = Readonly<{
  price: string;
  stock_management: true;
  stock: number;
  sku?: string;
  weight?: string;
  width?: string;
  height?: string;
  depth?: string;
  values?: readonly TiendanubeLocalizedValueDto[];
  image_id?: number;
  imageSrc?: string;
}>;

export type TiendanubeCreateProductDto = Readonly<{
  name: TiendanubeLocalizedValueDto;
  description?: TiendanubeLocalizedValueDto;
  visibility: 'visible';
  images: readonly Readonly<{ src: string }>[];
  attributes: readonly TiendanubeLocalizedValueDto[];
  variants: readonly TiendanubeCreateProductVariantDto[];
  brand?: string;
  categories?: readonly number[];
  tags?: string;
  seo_title?: string;
  seo_description?: string;
}>;

export type TiendanubeReplicationOptions = Readonly<{
  priceMode: 'KEEP_SOURCE' | 'OVERRIDE';
  price?: number;
  categoryId: number;
  tagMode: 'KEEP_SOURCE' | 'OVERRIDE';
  tags?: string[];
}>;

export type TiendanubeUpdateProductDto = Readonly<{
  name: TiendanubeLocalizedValueDto;
  description?: TiendanubeLocalizedValueDto;
  visibility: 'visible';
  attributes: readonly TiendanubeLocalizedValueDto[];
  brand?: string;
  categories?: readonly number[];
  tags?: string;
  seo_title?: string;
  seo_description?: string;
}>;
