import type { Json } from '../../../database/database.types';

import type { PromotionErrorCode } from './promotion-errors';
import type { PromotionSwitchRequest } from './promotion-manager.types';

export type PromotionBulkJobStatus =
  'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS';

export type PromotionBulkItemStatus =
  'QUEUED' | 'PROCESSING' | 'SCHEDULED' | 'ACTIVE' | 'ERROR';

export type PromotionBulkJob = Readonly<{
  id: string;
  user_id: string;
  seller_id: number;
  status: PromotionBulkJobStatus;
  total_items: number;
  processed_items: number;
  successful_items: number;
  failed_items: number;
  locked_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}>;

export type PromotionBulkJobItem = Readonly<{
  id: string;
  job_id: string;
  position: number;
  item_id: string;
  request: Json;
  status: PromotionBulkItemStatus;
  error_code: string | null;
  provider_message: string | null;
  processing_started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}>;

export type PromotionBulkJobInputItem = Readonly<{
  itemId: string;
  request: PromotionSwitchRequest;
}>;

export type PromotionBulkJobResponse = Readonly<{
  jobId: string;
  status: PromotionBulkJobStatus;
  totalItems: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  items: ReadonlyArray<{
    itemId: string;
    status: PromotionBulkItemStatus;
    errorCode?: PromotionErrorCode;
    providerMessage?: string;
  }>;
}>;

export type PromotionBulkProcessResult = Readonly<{
  hasMore: boolean;
  retryAfterSeconds?: number;
}>;
