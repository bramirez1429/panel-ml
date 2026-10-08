import { Database } from '../database.types';

type SyncJobRow = Database['public']['Tables']['mercadolibre_sync_jobs']['Row'];

export type MercadolibreSyncJob = Omit<SyncJobRow, 'buffer_item_ids'> & {
  buffer_item_ids: string[];
};

export type CreateMercadolibreSyncJobInput = {
  id: string;
  sellerId: number;
  fullSyncId: string;
  totalItems: number;
};

export type UpdateMercadolibreSyncJobProgressInput = {
  scanStarted: boolean;
  scrollId: string | null;
  bufferItemIds: string[];
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  productsSaved: number;
  childrenSaved: number;
  errorsCount: number;
};
