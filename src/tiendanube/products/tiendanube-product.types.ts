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

<<<<<<< HEAD
export type TiendanubeProductByMercadolibreResponse = Readonly<{
  linked: boolean;
  price: number | null;
  promotionalPrice: number | null;
  stock: number | null;
  sku: string | null;
}>;

=======
>>>>>>> origin/feat/sincronizacion-publicaciones
export type TiendanubeCatalogVariantAttributeResponse = Readonly<{
  name: TiendanubeLocalizedText | null;
  value: TiendanubeLocalizedText;
}>;

export type TiendanubeCatalogProductVariantResponse = Readonly<{
  id: number;
  attributes: readonly TiendanubeCatalogVariantAttributeResponse[];
  sku: string | null;
  stock: number | null;
  stockManagement: boolean;
  price: number | null;
  promotionalPrice: number | null;
}>;

export type TiendanubeCatalogProductResponse = Readonly<{
  id: number;
  name: TiendanubeLocalizedText;
  mainImage: string | null;
  tags: readonly string[];
  published: boolean;
  visibility: 'visible' | 'unlisted' | 'hidden';
  variants: readonly TiendanubeCatalogProductVariantResponse[];
}>;

export type TiendanubeProductsCatalogResponse = Readonly<{
  products: readonly TiendanubeCatalogProductResponse[];
  page: number;
  hasMore: boolean;
  total?: number;
}>;

export type TiendanubeProductsCatalogQuery = Readonly<{
  page: number;
  limit: number;
  q?: string;
}>;
