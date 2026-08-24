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
  values: readonly ReplicableProductVariantValue[];
}>;

export type ReplicableProduct = Readonly<{
  title: string;
  images: readonly string[];
  attributes: readonly ReplicableProductAttribute[];
  variants: readonly ReplicableProductVariant[];
}>;

export type TiendanubeLocalizedValueDto = Readonly<{
  es: string;
}>;

export type TiendanubeCreateProductVariantDto = Readonly<{
  price: string;
  stock_management: true;
  stock: number;
  sku?: string;
  values?: readonly TiendanubeLocalizedValueDto[];
}>;

export type TiendanubeCreateProductDto = Readonly<{
  name: TiendanubeLocalizedValueDto;
  visibility: 'hidden';
  images: readonly Readonly<{ src: string }>[];
  attributes: readonly TiendanubeLocalizedValueDto[];
  variants: readonly TiendanubeCreateProductVariantDto[];
}>;
