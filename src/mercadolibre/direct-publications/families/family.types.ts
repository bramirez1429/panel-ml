import {
  MlAttribute,
  MlPicture,
} from '../items/items.types';

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