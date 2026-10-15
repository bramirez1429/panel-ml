export type TiendanubeMigrationJobStatus =
  | 'DISCOVERING'
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_RECONCILIATION'
  | 'PAUSED'
  | 'COMPLETED'
  | 'COMPLETED_WITH_REJECTIONS';

export type TiendanubeMigrationItemStatus =
  'PENDING' | 'PROCESSING' | 'RECONCILING' | 'APPROVED' | 'REJECTED';

export type TiendanubeMigrationOutcome = 'CREATED' | 'ALREADY_EXISTS';

export type TiendanubeMigrationJob = Readonly<{
  id: string;
  user_id: string;
  seller_id: number;
  store_id: string;
  status: TiendanubeMigrationJobStatus;
  total_items: number;
  processed_items: number;
  approved_items: number;
  rejected_items: number;
  current_source_key: string | null;
  test_limit: 1 | 5 | 10 | null;
  scan_scroll_id: string | null;
  locked_until: string | null;
  next_run_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}>;

export type TiendanubeMigrationItem = Readonly<{
  id: string;
  job_id: string;
  source_key: string;
  title: string | null;
  mla_ids: readonly string[];
  family_id: string | null;
  mlau_ids: readonly string[];
  status: TiendanubeMigrationItemStatus;
  outcome: TiendanubeMigrationOutcome | null;
  tiendanube_product_id: string | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  post_started_at: string | null;
  created_at: string;
  updated_at: string;
}>;

export type ClaimedTiendanubeMigrationItem = Readonly<{
  id: string;
  sourceKey: string;
  title: string | null;
  mlaIds: readonly string[];
  familyId: string | null;
  mlauIds: readonly string[];
  attempts: number;
  isReconciliation: boolean;
}>;

export type DiscoveredTiendanubeMigrationItem = Readonly<{
  sourceKey: string;
  title: string | null;
  mlaIds: readonly string[];
  familyId: string | null;
  mlauIds: readonly string[];
}>;

export type TiendanubeMigrationJobResponse = Readonly<{
  id: string;
  status: TiendanubeMigrationJobStatus;
  totalItems: number;
  processedItems: number;
  approvedItems: number;
  rejectedItems: number;
  currentSourceKey: string | null;
  testLimit: 1 | 5 | 10 | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}>;

export type TiendanubeMigrationItemsPage = Readonly<{
  page: number;
  limit: number;
  total: number;
  items: readonly Readonly<{
    sourceKey: string;
    title: string | null;
    mlaIds: readonly string[];
    familyId: string | null;
    mlauIds: readonly string[];
    status: TiendanubeMigrationItemStatus;
    outcome: TiendanubeMigrationOutcome | null;
    tiendanubeProductId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    attempts: number;
    updatedAt: string;
  }>[];
}>;
