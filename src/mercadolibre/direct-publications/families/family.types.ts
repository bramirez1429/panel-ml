import { MlAttribute, MlPicture } from '../items/items.types';

export type FamilyItemSummary = {
  itemId: string;
  title: string | null;

  price: number | null;
  stock: number;
  sold: number;

  status: string | null;

  inventoryId: string | null;

  thumbnail: string | null;
  pictures: MlPicture[];

  attributes: MlAttribute[];
};

export type FamilyVariantSummary = {
  userProductId: string;
  items: FamilyItemSummary[];
};

export type FamilySummary = {
  key: string;
  model: 'VARIANT_PRICING';

  familyId: string;
  familyName: string | null;

  variantsCount: number;
  itemsCount: number;

  variants: FamilyVariantSummary[];
};

/** Agregados suficientes para una fila del listado, sin detalle de variantes. */
export type FamilyListingSummary = {
  key: string;
  model: 'VARIANT_PRICING';
  familyId: string;
  familyName: string | null;
  variantsCount: number;
  itemsCount: number;
  itemId: string | null;
  userProductId: string | null;
  title: string | null;
  priceFrom: number | null;
  priceTo: number | null;
  currency: string | null;
  stock: number;
  sold: number;
  status: string | null;
  thumbnail: string | null;
  permalink: string | null;
};
