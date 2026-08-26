export type TiendanubeCategory = Readonly<{
  id: number;
  name: string;
  parentId: number | null;
}>;

export type TiendanubeCategoriesResponse = Readonly<{
  items: readonly TiendanubeCategory[];
}>;

export type TiendanubeStoreSummary = Readonly<{ planName: string }>;
