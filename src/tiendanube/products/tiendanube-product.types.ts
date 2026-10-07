export type TiendanubeLocalizedText = Readonly<Record<string, string>>;

export type TiendanubeProductVariantResponse = Readonly<{
  id: number;
}>;

export type TiendanubeProductImageResponse = Readonly<{
  id: number;
  src: string;
  position: number;
}>;

export type TiendanubeProductResponse = Readonly<{
  id: number;
  name: TiendanubeLocalizedText;
  published: boolean;
  variants: readonly TiendanubeProductVariantResponse[];
  images: readonly TiendanubeProductImageResponse[];
}>;

export type TiendanubeProductByMercadolibreResponse = Readonly<{
  linked: boolean;
  price: number | null;
  promotionalPrice: number | null;
  stock: number | null;
  sku: string | null;
}>;
