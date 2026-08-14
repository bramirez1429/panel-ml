import type { Json } from '../../../database/database.types';

export const PUBLICATION_ACTIONS = [
  'PRICE_UPDATED',
  'STOCK_UPDATED',
  'SKU_UPDATED',
  'PICTURES_UPDATED',
  'PAUSED',
  'ACTIVATED',
  'TITLE_UPDATED',
  'DESCRIPTION_UPDATED',
  'ATTRIBUTES_UPDATED',
  'PROMOTION_APPLIED',
  'PROMOTION_REMOVED',
  'PUBLISHED',
] as const;

export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];
export type PublicationActionStatus = 'SUCCESS' | 'FAILED';

export type PublicationActionWrite = Readonly<{
  sellerId: number;
  productId: string;
  itemId?: string | null;
  action: PublicationAction;
  status: PublicationActionStatus;
  oldValue?: unknown;
  newValue?: unknown;
  errorMessage?: string | null;
}>;

export type PublicationActionInsert = Readonly<{
  sellerId: number;
  productId: string;
  itemId: string | null;
  action: PublicationAction;
  status: PublicationActionStatus;
  oldValue: Json | null;
  newValue: Json | null;
  errorMessage: string | null;
}>;
