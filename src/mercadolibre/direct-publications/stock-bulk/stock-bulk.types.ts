import { BadRequestException } from '@nestjs/common';

export const STOCK_BULK_PRODUCT_TYPES = [
  'BUZO_MUJER',
  'BUZO_NENA',
  'REMERA_MUJER',
  'REMERA_NENA',
] as const;

export type StockBulkProductType = (typeof STOCK_BULK_PRODUCT_TYPES)[number];
export type StockBulkModel = 'USER_PRODUCT' | 'LEGACY';
export type StockBulkItemStatus =
  'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR' | 'SKIPPED';
export type StockBulkJobStatus =
  'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';

export type StockBulkSizeRequest = Readonly<{
  size: string;
  quantity: number;
}>;

export type StockBulkPreviewRequest = Readonly<{
  productType: StockBulkProductType;
  sizes: readonly StockBulkSizeRequest[];
}>;

export type StockBulkTarget = Readonly<{
  identifier: string;
  title: string | null;
  color: string | null;
  size: string;
  itemId: string;
  userProductId: string | null;
  variationId: string | null;
  familyId: string | null;
  model: StockBulkModel;
  currentQuantity: number;
  requestedQuantity: number;
  currentStatus: string | null;
  needsChange: boolean;
  editable: boolean;
  reason?: string;
  storeId?: string;
  networkNodeId?: string;
}>;

export type StockBulkPreview = Readonly<{
  productType: StockBulkProductType;
  results: readonly StockBulkTarget[];
  summary: Readonly<{
    totalFound: number;
    editable: number;
    unchanged: number;
    active: number;
    paused: number;
    outOfStock: number;
    userProduct: number;
    legacy: number;
  }>;
}>;

export type StockBulkJob = Readonly<{
  id: string;
  user_id: string;
  seller_id: number;
  status: StockBulkJobStatus;
  total_items: number;
  processed_items: number;
  successful_items: number;
  failed_items: number;
  skipped_items: number;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}>;

export type StockBulkJobItem = Readonly<{
  id: string;
  job_id: string;
  position: number;
  identifier: string;
  title: string | null;
  color: string | null;
  size: string;
  item_id: string;
  user_product_id: string | null;
  variation_id: string | null;
  family_id: string | null;
  model: StockBulkModel;
  old_quantity: number;
  new_quantity: number;
  old_status: string | null;
  store_id: string | null;
  network_node_id: string | null;
  editable: boolean;
  reason: string | null;
  status: StockBulkItemStatus;
  attempt_count: number;
  result: unknown;
  error_code: string | null;
  error_message: string | null;
  processing_started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}>;

export type StockBulkProcessResult = Readonly<{
  hasMore: boolean;
  retryAfterSeconds?: number;
}>;

const MAX_SIZES = 100;
const MAX_TARGETS = 1_000;

export function parseStockBulkPreviewRequest(
  value: unknown,
): StockBulkPreviewRequest {
  if (!isRecord(value) || !isProductType(value.productType)) invalidPreview();
  if (
    !Array.isArray(value.sizes) ||
    value.sizes.length === 0 ||
    value.sizes.length > MAX_SIZES
  ) {
    throw new BadRequestException(
      `sizes debe contener entre 1 y ${MAX_SIZES} talles`,
    );
  }

  const seen = new Set<string>();
  const sizes = value.sizes.map((entry) => {
    if (!isRecord(entry)) invalidPreview();
    const size = text(entry.size);
    const quantity = entry.quantity;
    if (!size || !isQuantity(quantity)) invalidPreview();
    const key = normalizeLabel(size);
    if (seen.has(key)) {
      throw new BadRequestException(`El talle ${size} est\u00e1 repetido`);
    }
    seen.add(key);
    return { size, quantity };
  });

  return { productType: value.productType, sizes };
}

export function parseStockBulkJobRequest(value: unknown): StockBulkTarget[] {
  if (!isRecord(value) || !Array.isArray(value.targets)) invalidJob();
  if (value.targets.length === 0 || value.targets.length > MAX_TARGETS) {
    throw new BadRequestException(
      `targets debe contener entre 1 y ${MAX_TARGETS} elementos`,
    );
  }
  const identifiers = new Set<string>();
  return value.targets.map((entry) => {
    if (!isRecord(entry)) invalidJob();
    const target = parseTarget(entry);
    if (identifiers.has(target.identifier)) {
      throw new BadRequestException(
        `El target ${target.identifier} est\u00e1 repetido`,
      );
    }
    identifiers.add(target.identifier);
    return target;
  });
}

function parseTarget(value: Record<string, unknown>): StockBulkTarget {
  const model = value.model;
  const itemId = text(value.itemId);
  const identifier = text(value.identifier);
  const size = text(value.size);
  const currentQuantity = value.currentQuantity;
  const requestedQuantity = value.requestedQuantity;
  const variationId = optionalText(value.variationId);
  const familyId = optionalText(value.familyId);
  const userProductId = optionalText(value.userProductId);
  if (
    (model !== 'USER_PRODUCT' && model !== 'LEGACY') ||
    !/^MLA\d+$/u.test(itemId) ||
    !identifier ||
    !size ||
    !isQuantity(currentQuantity) ||
    !isQuantity(requestedQuantity)
  ) {
    invalidJob();
  }
  if (
    model === 'USER_PRODUCT' &&
    (!/^MLAU\d+$/u.test(userProductId ?? '') || !/^\d+$/u.test(familyId ?? ''))
  ) {
    invalidJob();
  }
  if (model === 'LEGACY' && variationId && !/^\d+$/u.test(variationId)) {
    invalidJob();
  }

  const editable = value.editable === true;
  return {
    identifier,
    title: optionalText(value.title),
    color: optionalText(value.color),
    size,
    itemId,
    userProductId,
    variationId,
    familyId,
    model,
    currentQuantity,
    requestedQuantity,
    currentStatus: optionalText(value.currentStatus),
    needsChange: currentQuantity !== requestedQuantity,
    editable,
    ...(!editable
      ? { reason: optionalText(value.reason) ?? 'TARGET_NOT_EDITABLE' }
      : {}),
    ...(optionalText(value.storeId)
      ? { storeId: optionalText(value.storeId) as string }
      : {}),
    ...(optionalText(value.networkNodeId)
      ? { networkNodeId: optionalText(value.networkNodeId) as string }
      : {}),
  };
}

export function normalizeStockBulkLabel(value: unknown): string {
  return normalizeLabel(text(value));
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .trim()
    .toUpperCase();
}

function isProductType(value: unknown): value is StockBulkProductType {
  return STOCK_BULK_PRODUCT_TYPES.includes(value as StockBulkProductType);
}

function isQuantity(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidPreview(): never {
  throw new BadRequestException(
    'Solicitud de preview de stock masivo inv\u00e1lida',
  );
}

function invalidJob(): never {
  throw new BadRequestException(
    'Solicitud de job de stock masivo inv\u00e1lida',
  );
}
