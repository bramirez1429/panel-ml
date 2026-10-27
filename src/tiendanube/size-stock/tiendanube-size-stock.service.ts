import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';

export type TiendanubeSizeStockUpdate = Readonly<{
  productId: string;
  variantId: string;
  size: string;
  color: string | null;
  expectedStock: number | null;
  stock: number;
}>;

export type TiendanubeSizeStockBatchRequest = Readonly<{
  updates: readonly TiendanubeSizeStockUpdate[];
}>;

export type TiendanubeSizeStockBatchResult = Readonly<{
  updatedVariantIds: readonly string[];
  failedVariantIds: readonly string[];
}>;

type JsonRecord = Record<string, unknown>;

const BATCH_LIMIT = 20;
const MAX_STOCK = 1_000_000;

/**
 * Dedicated, fail-closed inventory writer. Never edits prices, SKU, options or
 * products. All affected variants are verified against Tiendanube at write time.
 */
@Injectable()
export class TiendanubeSizeStockService {
  constructor(
    private readonly connections: TiendanubeConnectionRepository,
    private readonly api: TiendanubeApiService,
  ) {}

  async applyBatch(
    userId: string,
    request: TiendanubeSizeStockBatchRequest,
  ): Promise<TiendanubeSizeStockBatchResult> {
    const updates = validateBatch(request);
    const connection = await this.connections.findOwnedCredentialsByUserId(userId);
    if (!connection?.accessToken?.trim()) {
      throw new UnauthorizedException('Primero conectá Tiendanube.');
    }
    const grouped = new Map<string, TiendanubeSizeStockUpdate[]>();
    for (const update of updates) {
      grouped.set(update.productId, [...(grouped.get(update.productId) ?? []), update]);
    }

    const products = new Map<string, JsonRecord>();
    // Read each product only once, independently of how many variants are selected.
    for (const productId of grouped.keys()) {
      const source = await this.api.get<unknown>(
        connection.storeId,
        '/products/' + encodeURIComponent(productId),
        connection.accessToken,
      );
      if (!record(source)) {
        throw new BadGatewayException('Tiendanube devolvió un producto inválido.');
      }
      products.set(productId, source);
    }

    // Preflight every line before the first write: reject the complete batch
    // when a product is hidden, an ID is stale or inventory has multiple locations.
    for (const [productId, lines] of grouped) {
      const product = products.get(productId);
      if (!product) throw new BadGatewayException('Producto no encontrado en la verificación.');
      if (!visibleProduct(product)) {
        throw new ConflictException('Uno de los productos dejó de estar visible. Actualizá la búsqueda.');
      }
      if (!Array.isArray(product.variants)) {
        throw new BadGatewayException('Tiendanube no devolvió variantes válidas.');
      }

      for (const line of lines) {
        const variant = product.variants.find((item: unknown) =>
          record(item) && String(item.id) === line.variantId,
        );
        if (!record(variant) || variant.visible === false) {
          throw new ConflictException('Una variante no existe o dejó de estar visible. Actualizá la búsqueda.');
        }

        const size = sizeOf(product, variant);
        if (!size || canonical(size) !== canonical(line.size)) {
          throw new ConflictException('El talle cambió desde la última búsqueda. Actualizá antes de aplicar.');
        }
        const color = colorOf(product, variant);
        if (line.color === null ? color !== null :
            !color || canonical(color) !== canonical(line.color)) {
          throw new ConflictException('El color cambió desde la última búsqueda. Actualizá antes de aplicar.');
        }
        const levels = variant.inventory_levels;
        if (Array.isArray(levels) && levels.length > 1) {
          throw new ConflictException('Hay variantes con varios depósitos. No se modifica stock sin elegir una ubicación.');
        }
        if (currentStock(variant) !== line.expectedStock) {
          throw new ConflictException('El stock cambió desde la última búsqueda. Actualizá antes de aplicar.');
        }
      }
    }

    const payload = [...grouped].map(([id, lines]) => ({
      id: Number(id),
      variants: lines.map((line) => ({
        id: Number(line.variantId),
        inventory_levels: [{ stock: line.stock }],
      })),
    }));

    await this.api.patch<unknown>(
      connection.storeId,
      '/products/stock-price',
      payload,
      connection.accessToken,
    );

    // Read-back verification; a successful HTTP response alone isn't enough.
    const updatedVariantIds: string[] = [];
    const failedVariantIds: string[] = [];
    for (const [productId, lines] of grouped) {
      const fresh = await this.api.get<unknown>(
        connection.storeId,
        '/products/' + encodeURIComponent(productId),
        connection.accessToken,
      );
      if (!record(fresh) || !Array.isArray(fresh.variants)) {
        failedVariantIds.push(...lines.map((line) => line.variantId));
        continue;
      }
      for (const line of lines) {
        const found = fresh.variants.find((v: unknown) =>
          record(v) && String(v.id) === line.variantId,
        );
        if (record(found) && currentStock(found) === line.stock) {
          updatedVariantIds.push(line.variantId);
        } else {
          failedVariantIds.push(line.variantId);
        }
      }
    }

    return { updatedVariantIds, failedVariantIds };
  }
}

function validateBatch(input: unknown): readonly TiendanubeSizeStockUpdate[] {
  if (!record(input) || !Array.isArray(input.updates) ||
      input.updates.length === 0 || input.updates.length > BATCH_LIMIT) {
    throw new BadRequestException('Enviá entre 1 y 20 variantes por lote.');
  }
  const unique = new Set<string>();
  for (const row of input.updates) {
    if (!record(row) ||
        !positiveId(row.productId) || !positiveId(row.variantId) ||
        typeof row.size !== 'string' || !row.size.trim() || row.size.length > 80 ||
        !(row.color === null ||
          (typeof row.color === 'string' && row.color.trim() && row.color.length <= 80)) ||
        !Number.isSafeInteger(row.stock) || Number(row.stock) < 0 ||
        Number(row.stock) > MAX_STOCK ||
        !(row.expectedStock === null ||
          (typeof row.expectedStock === 'number' &&
            Number.isSafeInteger(row.expectedStock) && row.expectedStock >= 0))) {
      throw new BadRequestException('Hay un ID, talle o stock inválido.');
    }
    const key = row.productId + ':' + row.variantId;
    if (unique.has(key)) {
      throw new BadRequestException('No se puede enviar dos veces la misma variante.');
    }
    unique.add(key);
  }
  return input.updates as readonly TiendanubeSizeStockUpdate[];
}

function positiveId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/u.test(value);
}

function record(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').trim().toUpperCase();
}

function localized(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!record(value)) return null;
  const text = value.es ?? value.pt ?? value.en ?? Object.values(value)[0];
  return typeof text === 'string' ? text.trim() || null : null;
}

function visibleProduct(product: JsonRecord): boolean {
  if (product.visibility !== undefined && product.visibility !== null) {
    return product.visibility === 'visible';
  }
  return product.published === true;
}

function optionOf(product: JsonRecord, variant: JsonRecord, allowed: readonly string[]): string | null {
  const names = product.attributes;
  const values = variant.values;
  if (!Array.isArray(names) || !Array.isArray(values)) return null;
  const index = names.findIndex((name: unknown) => allowed.includes(canonical(localized(name) ?? '')));
  return index < 0 ? null : localized(values[index]);
}

function sizeOf(product: JsonRecord, variant: JsonRecord): string | null {
  return optionOf(product, variant, ['TALLE', 'TALLES', 'TALLA', 'TAMANO', 'SIZE', 'SIZES']);
}

function colorOf(product: JsonRecord, variant: JsonRecord): string | null {
  return optionOf(product, variant, ['COLOR', 'COLOUR']);
}

function currentStock(variant: JsonRecord): number | null {
  const levels = variant.inventory_levels;
  // Single-location stores may express stock only in inventory_levels.
  if (Array.isArray(levels) && levels.length === 1) {
    const first = levels[0];
    if (record(first)) return asStock(first.stock);
  }
  return asStock(variant.stock);
}

function asStock(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value);
  return null;
}
