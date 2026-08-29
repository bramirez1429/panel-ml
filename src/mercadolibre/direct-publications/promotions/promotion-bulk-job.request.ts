import { BadRequestException } from '@nestjs/common';

import type { PromotionBulkJobInputItem } from './promotion-bulk-job.types';
import { parsePromotionRequest } from './publication-promotion-request';

const MAX_BULK_ITEMS = 100;

export function parsePromotionBulkJobRequest(
  value: unknown,
): PromotionBulkJobInputItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return invalid();
  if (value.items.length === 0 || value.items.length > MAX_BULK_ITEMS) {
    throw new BadRequestException(
      `items debe contener entre 1 y ${MAX_BULK_ITEMS} promociones`,
    );
  }
  return value.items.map((item) => {
    if (!isRecord(item) || !/^MLA\d+$/u.test(text(item.itemId))) {
      throw new BadRequestException('Cada item debe informar un itemId MLA');
    }
    return {
      itemId: text(item.itemId),
      request: parsePromotionRequest(item.request),
    };
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new BadRequestException('Solicitud bulk de promociones inválida');
}
