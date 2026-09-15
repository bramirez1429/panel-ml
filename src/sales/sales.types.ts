import type {
  RecentSaleChannel,
  SaleMappingStatus,
} from '../database/database.types';

export type RecentSale = Readonly<{
  id: string;
  userId: string;
  channel: RecentSaleChannel;
  externalOrderId: string;
  externalOrderItemId: string;
  soldAt: string;
  quantity: number;
  productName: string;
  sku: string | null;
  mlItemId: string | null;
  mlVariationId: string | null;
  userProductId: string | null;
  familyId: string | null;
  tnProductId: string | null;
  tnVariantId: string | null;
  color: string | null;
  size: string | null;
  mappingStatus: SaleMappingStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type SaveRecentSale = Omit<RecentSale, 'id' | 'createdAt' | 'updatedAt'>;

export type VariantChannelLink = Readonly<{
  id: string;
  userId: string;
  mlItemId: string;
  mlVariationId: string | null;
  userProductId: string | null;
  familyId: string | null;
  tnProductId: string;
  tnVariantId: string;
  sku: string | null;
  normalizedColor: string | null;
  normalizedSize: string | null;
  matchSource: 'MANUAL' | 'SKU' | 'ATTRIBUTES';
  createdAt: string;
  updatedAt: string;
}>;

export type SaveVariantChannelLink = Omit<
  VariantChannelLink,
  'id' | 'createdAt' | 'updatedAt'
>;

export type ChannelVariant = Readonly<{
  sku: string | null;
  color: string | null;
  size: string | null;
  ml: Readonly<{
    itemId: string;
    variationId: string | null;
    userProductId: string | null;
    familyId: string | null;
    stock: number | null;
  }> | null;
  tiendaNube: Readonly<{
    productId: string;
    variantId: string;
    stock: number | null;
  }> | null;
}>;

export type DetailedVariant = ChannelVariant &
  Readonly<{
    difference: number | null;
    stockDifference: number | null;
    hasStockDifference: boolean | null;
    mappingStatus: SaleMappingStatus;
    stockStatus: 'OUT_OF_STOCK' | 'LOW' | 'OK' | null;
  }>;

export const RECENT_SALES_DEFAULT_HOURS = 48;
export const RECENT_SALES_MAX_HOURS = 24 * 31;
export const SALES_CURVE_CACHE_TTL_MS = 45_000;
export const OUT_OF_STOCK_MAX = 0;
export const LOW_STOCK_MAX = 2;
