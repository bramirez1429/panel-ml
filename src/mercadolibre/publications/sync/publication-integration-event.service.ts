import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  IntegrationEventType,
  Json,
} from '../../../database/database.types';
import { MercadolibreIntegrationEventsRepository } from '../../../database/repositories/mercadolibre-integration-events.repository';
import type { ClassifiedSyncError } from './publication-sync-error-classifier';

@Injectable()
export class PublicationIntegrationEventService {
  constructor(
    private readonly events: MercadolibreIntegrationEventsRepository,
  ) {}

  async recordPossibleChange(
    sellerId: number | null,
    endpoint: string,
    error: ClassifiedSyncError,
    metadata?: unknown,
  ): Promise<void> {
    const eventType: IntegrationEventType = 'POSSIBLE_API_CHANGE';
    const fingerprint = createHash('sha256')
      .update(
        [
          eventType,
          endpoint,
          error.httpStatus ?? '',
          error.code ?? '',
          error.message,
        ]
          .join('|')
          .toLowerCase(),
      )
      .digest('hex');
    await this.events.record({
      sellerId,
      eventType,
      endpoint,
      httpStatus: error.httpStatus,
      providerCode: error.code,
      message: error.message,
      fingerprint,
      metadata: sanitizeMetadata(metadata),
    });
  }
}

const SENSITIVE_KEY =
  /(authorization|token|cookie|secret|password|credential)/iu;

function sanitizeMetadata(value: unknown, depth = 0): Json | null {
  if (depth > 4 || value === undefined) return null;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return typeof value === 'string'
      ? value
          .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [REDACTED]')
          .replace(/(access_token|refresh_token)=([^\s&]+)/giu, '$1=[REDACTED]')
          .slice(0, 300)
      : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof value !== 'object') return null;
  const result: Record<string, Json | undefined> = {};
  for (const [key, child] of Object.entries(value).slice(0, 30)) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = sanitizeMetadata(child, depth + 1);
  }
  return result;
}
