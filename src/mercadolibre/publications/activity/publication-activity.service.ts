import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Json } from '../../../database/database.types';
import { MercadolibrePublicationActionsRepository } from '../../../database/repositories/mercadolibre-publication-actions.repository';
import { sanitizeMercadoLibreData } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { parseOptionalItemId } from '../mutations/publication-management.types';
import { PublicationManagementTargetService } from '../mutations/publication-management-target.service';
import type { PublicationActionWrite } from './publication-activity.types';

const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 100;

@Injectable()
export class PublicationActivityService {
  private readonly logger = new Logger(PublicationActivityService.name);

  constructor(
    private readonly repository: MercadolibrePublicationActionsRepository,
    private readonly targets: PublicationManagementTargetService,
  ) {}

  /** Guarda un evento sin permitir secretos ni valores no serializables. */
  async record(input: PublicationActionWrite): Promise<void> {
    await this.repository.insert({
      sellerId: input.sellerId,
      productId: input.productId,
      itemId: input.itemId ?? null,
      action: input.action,
      status: input.status,
      oldValue: safeJson(input.oldValue),
      newValue: safeJson(input.newValue),
      errorMessage: input.errorMessage?.slice(0, 1_000) ?? null,
    });
  }

  /** Auditar no debe convertir una mutacion externa exitosa en reintentable. */
  async recordBestEffort(input: PublicationActionWrite): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.error(
        'No se pudo registrar actividad de publicaciones',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Lista actividad reciente validando el filtro y el limite solicitado. */
  async list(
    productId: string,
    requestedItemId: unknown,
    requestedLimit?: unknown,
  ) {
    const itemId = parseOptionalItemId(requestedItemId);
    const limit = parseActivityLimit(requestedLimit);
    const context = itemId
      ? await this.targets.resolve(productId, itemId)
      : await this.targets.resolveProduct(productId);
    const rows = await this.repository.findRecent(
      context.sellerId,
      productId,
      itemId,
      limit,
    );
    return {
      productId,
      activities: rows.map((row) => ({
        id: row.id,
        sellerId: row.seller_id,
        productId: row.product_id,
        itemId: row.item_id,
        action: row.action,
        status: row.status,
        oldValue: row.old_value,
        newValue: row.new_value,
        errorMessage: row.error_message,
        createdAt: row.created_at,
      })),
    };
  }
}

function parseActivityLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_ACTIVITY_LIMIT;
  const normalized = typeof value === 'string' ? value.trim() : value;
  const parsed =
    typeof normalized === 'string' && /^\d+$/.test(normalized)
      ? Number(normalized)
      : normalized;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) {
    throw new BadRequestException('limit debe ser un entero mayor a 0');
  }
  return Math.min(Number(parsed), MAX_ACTIVITY_LIMIT);
}

export function publicationActionErrorMessage(error: unknown): string {
  if (!(error instanceof HttpException)) {
    return 'La operacion no pudo completarse';
  }
  const response = sanitizeMercadoLibreData(error.getResponse());
  if (typeof response === 'string') return response.slice(0, 1_000);
  if (isJsonObject(response)) {
    const message = response.message;
    if (typeof message === 'string') return message.slice(0, 1_000);
    if (Array.isArray(message)) {
      return message
        .filter((value): value is string => typeof value === 'string')
        .join('; ')
        .slice(0, 1_000);
    }
  }
  return 'Mercado Libre rechazo la operacion';
}

function safeJson(value: unknown): Json | null {
  if (value === undefined) return null;
  return normalizeJson(sanitizeMercadoLibreData(value));
}

function normalizeJson(value: unknown): Json {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (!isJsonObject(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, nested]) =>
          nested !== undefined &&
          !['token', 'secret', 'authorization'].some((privatePart) =>
            key.toLowerCase().includes(privatePart),
          ),
      )
      .map(([key, nested]) => [key, normalizeJson(nested)]),
  );
}
