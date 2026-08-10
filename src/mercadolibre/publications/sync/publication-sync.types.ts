import {
  MercadoLibrePublication,
  NormalizedPublicationBundle,
} from '../publication.types';

export type PublicationSyncError = {
  itemId: string;
  message: string;
};

export type PublicationSyncSummary = {
  ok: true;
  syncId: string;
  totalItemIds: number;
  processedItems: number;
  productsSaved: number;
  childrenSaved: number;
  cleanupPerformed: boolean;
  errors: PublicationSyncError[];
};

export type PublicationBatchResult = {
  productsSaved: number;
  childrenSaved: number;
  errors: PublicationSyncError[];
};

export type PublicationScanPage = {
  itemIds: string[];
  scrollId: string | null;
};

export type ClassifiedPublications = {
  shared: MercadoLibrePublication[];
  variants: MercadoLibrePublication[];
};

export type SavedPublications = {
  processedItems: number;
  productsSaved: number;
  childrenSaved: number;
};

export type SyncAccess = {
  sellerId: number;
  accessToken: string;
};

export type PreparedPublications = {
  bundles: NormalizedPublicationBundle[];
  errors: PublicationSyncError[];
};
