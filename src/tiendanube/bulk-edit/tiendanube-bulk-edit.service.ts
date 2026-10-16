import { BadGatewayException, BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { TiendanubeCategoriesService } from '../categories/tiendanube-categories.service';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeBulkEditRepository } from './tiendanube-bulk-edit.repository';
import type { BulkEditChanges, BulkEditVariant } from './tiendanube-bulk-edit.types';

@Injectable()
export class TiendanubeBulkEditService {
  constructor(private readonly connections: TiendanubeConnectionRepository, private readonly api: TiendanubeApiService, private readonly categories: TiendanubeCategoriesService, private readonly repository: TiendanubeBulkEditRepository) {}

  categoriesByUser(userId: string) { return this.categories.listByUserId(userId); }

  async summary(userId: string, categoryId: string) {
    const variants = await this.loadVariants(userId, categoryId);
    return { categoryId, totalProducts: new Set(variants.map((v) => v.productId)).size, totalVariants: variants.length, variants };
  }

  async preview(userId: string, input: { categoryId: string; changes: BulkEditChanges }) {
    validateChanges(input.changes);
    const connection = await this.connection(userId);
    const variants = await this.loadVariantsFor(connection.storeId, connection.accessToken, input.categoryId);
    const incompatible = variants.flatMap((variant) => incompatibleVariant(variant, input.changes));
    const snapshot = await this.repository.saveSnapshot({ user_id: userId, store_id: connection.storeId, category_id: input.categoryId, changes: input.changes, variants });
    return { snapshotId: snapshot.id, categoryId: input.categoryId, totalProducts: new Set(variants.map((v) => v.productId)).size, totalVariants: variants.length, changes: input.changes, incompatible, generatedAt: new Date().toISOString(), expiresAt: snapshot.expires_at };
  }

  async createJob(userId: string, snapshotId: string): Promise<string> {
    const connection = await this.connection(userId);
    const snapshot = await this.repository.getSnapshot(snapshotId, userId, connection.storeId);
    if (!snapshot || Date.parse(snapshot.expires_at) <= Date.now()) throw new ConflictException('La vista previa venció o no pertenece a la tienda');
    return this.repository.createJob(snapshot);
  }

  async activeJob(userId: string) {
    const connection = await this.connection(userId);
    const job = await this.repository.findActive(userId, connection.storeId);
    if (!job) return null;
    return {
      id: job.id,
      status: job.status,
      categoryId: job.category_id,
      totalProducts: job.total_products,
      totalVariants: job.total_variants,
      completedVariants: job.completed_variants,
      failedVariants: job.failed_variants,
      pendingVariants: Math.max(0, job.total_variants - job.completed_variants - job.failed_variants),
      startedAt: job.started_at,
      finishedAt: job.finished_at,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    };
  }

  private async loadVariants(userId: string, categoryId: string) { const connection = await this.connection(userId); return this.loadVariantsFor(connection.storeId, connection.accessToken, categoryId); }
  private async connection(userId: string) { const connection = await this.connections.findOwnedCredentialsByUserId(userId); if (!connection?.accessToken.trim()) throw new UnauthorizedException('Primero conectá Tiendanube'); return connection; }

  private async loadVariantsFor(storeId: string, token: string, categoryId: string): Promise<readonly BulkEditVariant[]> {
    if (!/^\d+$/u.test(categoryId)) throw new BadRequestException('categoryId inválido');
    const products = new Map<string, Record<string, unknown>>();
    for (let page = 1; page <= 10_000; page += 1) {
      const response = await this.api.get<unknown>(storeId, `/products?category_id=${encodeURIComponent(categoryId)}&page=${page}&per_page=200`, token);
      if (!Array.isArray(response)) throw new BadGatewayException('Tiendanube devolvió productos inválidos');
      for (const product of response) if (isObject(product) && id(product.id)) products.set(String(product.id), product);
      if (response.length < 200) break;
    }
    return [...products.values()].flatMap(productVariants);
  }
}

function validateChanges(changes: BulkEditChanges): void {
  if (changes.price === undefined && changes.promotionalPrice === undefined && changes.stock === undefined) throw new BadRequestException('Indicá al menos un campo para editar');
  for (const price of [changes.price, changes.promotionalPrice]) if (price !== undefined && (!/^\d+(\.\d{1,2})?$/u.test(price) || Number(price) <= 0)) throw new BadRequestException('Los precios deben ser positivos con hasta dos decimales');
  if (changes.stock !== undefined && (!Number.isSafeInteger(changes.stock) || changes.stock < 0)) throw new BadRequestException('stock debe ser un entero no negativo');
}
function incompatibleVariant(v: BulkEditVariant, changes: BulkEditChanges) { if (changes.promotionalPrice !== undefined && Number(changes.promotionalPrice) >= Number(changes.price ?? v.price)) return [{ variantId: v.variantId, reason: 'El precio promocional debe ser menor al normal' }]; if (changes.stock !== undefined && v.inventoryLevels.length > 1 && !changes.locationId) return [{ variantId: v.variantId, reason: 'La tienda tiene múltiples ubicaciones; seleccioná una' }]; return []; }
function productVariants(product: Record<string, unknown>): BulkEditVariant[] { const variants = product.variants; if (!Array.isArray(variants)) return []; const productId = String(product.id); const productName = text(product.name) ?? productId; return variants.flatMap((raw) => { if (!isObject(raw) || !id(raw.id) || text(raw.price) === null) return []; const levels = Array.isArray(raw.inventory_levels) ? raw.inventory_levels.flatMap((level) => isObject(level) && id(level.location_id) && typeof level.stock === 'number' ? [{ locationId: String(level.location_id), stock: level.stock }] : []) : []; return [{ productId, productName, variantId: String(raw.id), sku: text(raw.sku), optionValues: Array.isArray(raw.values) ? raw.values.flatMap((v) => text(isObject(v) ? v.es : v) ?? []) : [], price: text(raw.price)!, promotionalPrice: text(raw.promotional_price), stock: typeof raw.stock === 'number' ? raw.stock : null, inventoryLevels: levels, url: text(product.url) }]; }); }
function id(value: unknown): value is string | number { return (typeof value === 'string' && /^\d+$/u.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value)); }
function text(value: unknown): string | null { if (typeof value === 'string' && value.trim()) return value.trim(); if (typeof value === 'number' && Number.isFinite(value)) return String(value); if (isObject(value)) return text(value.es) ?? Object.values(value).map(text).find((v): v is string => v !== null) ?? null; return null; }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
