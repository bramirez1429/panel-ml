import { MercadolibreSyncJob } from '../../../database/repositories/mercadolibre-sync-jobs.types';

export type SyncJobStartResponse = {
  ok: true;
  syncId: string;
  status: 'PENDING' | 'RUNNING';
  created: boolean;
};

export type SyncJobPendingResponse = {
  ok: true;
  syncId: string;
  status: 'PENDING';
  processedThisBatch: number;
  processedItems: number;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  percent: number;
  productsSaved: number;
  childrenSaved: number;
  errorsCount: number;
  hasMore: true;
};

export type SyncJobCompletedResponse = {
  ok: true;
  syncId: string;
  status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS';
  hasMore: false;
};

export type SyncJobNextResponse =
  SyncJobPendingResponse | SyncJobCompletedResponse;

export type SyncJobStatusResponse = {
  ok: true;
  syncId: string;
  status: MercadolibreSyncJob['status'];
  totalItems: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  percent: number;
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
