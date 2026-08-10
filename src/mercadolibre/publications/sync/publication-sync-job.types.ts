import { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';

export type SyncJobStartResponse = {
  ok: true;
  syncId: string;
  status: 'PENDING';
};

export type SyncJobPendingResponse = {
  ok: true;
  syncId: string;
  status: 'PENDING';
  processedThisBatch: number;
  processedItems: number;
  productsSaved: number;
  childrenSaved: number;
  errorsCount: number;
  hasMore: true;
};

export type SyncJobCompletedResponse = {
  ok: true;
  syncId: string;
  status: 'COMPLETED';
  hasMore: false;
};

export type SyncJobNextResponse =
  SyncJobPendingResponse | SyncJobCompletedResponse;

export type SyncJobStatusResponse = {
  ok: true;
  syncId: string;
  status: MercadolibreSyncJob['status'];
  processedItems: number;
  productsSaved: number;
  childrenSaved: number;
  errorsCount: number;
  lastError: string | null;
  hasMore: boolean;
};

export type SyncJobScanState = {
  scanStarted: boolean;
  scrollId: string | null;
  bufferItemIds: string[];
};
