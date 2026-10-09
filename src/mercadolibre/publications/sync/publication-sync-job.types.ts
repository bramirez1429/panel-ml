import { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';

export type SyncJobStatusResponse = {
  ok: true;
  syncId: string;
  status: MercadolibreSyncJob['status'];
  totalItems: number;
  processedItems: number;
  productsSaved: number;
  childrenSaved: number;
  errorsCount: number;
  lastError: string | null;
  hasMore: boolean;
};

export type SyncJobStartResponse = SyncJobStatusResponse;

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

export type SyncJobFailedResponse = {
  ok: true;
  syncId: string;
  status: 'FAILED';
  hasMore: false;
};

export type SyncJobNextResponse =
  | SyncJobPendingResponse
  | SyncJobCompletedResponse
  | SyncJobFailedResponse;

export type SyncJobScanState = {
  scanStarted: boolean;
  scrollId: string | null;
  bufferItemIds: string[];
};
