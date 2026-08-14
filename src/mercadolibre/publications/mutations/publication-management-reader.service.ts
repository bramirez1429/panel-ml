import { Injectable } from '@nestjs/common';
import type { Json } from '../../../database/database.types';
import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import type {
  MercadolibreChildRow,
  MercadolibreProductDetail,
} from '../../../database/repositories/mercadolibre-publications.types';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import { parseLiveAttributes, sellerSku } from './publication-management.types';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationSnapshotService } from './publication-snapshot.service';

const SNAPSHOT_TTL_MS = 5 * 60 * 1_000;

type SharedManagement = Readonly<{
  itemIds: string[];
  status: string | null;
  pictures: Json;
  sku: string | null;
  sharedSkus: Json;
  refreshedAt: string | null;
}>;

type ChildManagement = Readonly<{
  itemId: string;
  status: string | null;
  pictures: Json;
  sku: string | null;
  refreshedAt: string | null;
}>;

@Injectable()
export class PublicationManagementReaderService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly snapshots: PublicationSnapshotService,
    private readonly productsRepository: MercadolibreProductsRepository,
    private readonly childrenRepository: MercadolibreChildrenRepository,
  ) {}

  /** Refresca solamente snapshots vencidos y devuelve el shape guardado completo. */
  async hydrate(
    product: MercadolibreProductDetail,
    itemIds: string[],
  ): Promise<SharedManagement | ChildManagement[]> {
    if (product.model === 'SHARED') {
      return this.hydrateShared(product, itemIds);
    }
    return this.hydrateChildren(product, itemIds);
  }

  private async hydrateShared(
    product: MercadolibreProductDetail,
    itemIds: string[],
  ): Promise<SharedManagement> {
    if (isFresh(product.management_synced_at) || itemIds.length === 0) {
      return storedSharedManagement(product, itemIds);
    }
    await this.refreshTargets(product.id, itemIds);
    const stored = await this.productsRepository.findById(
      product.seller_id,
      product.id,
    );
    return storedSharedManagement(stored ?? product, itemIds);
  }

  private async hydrateChildren(
    product: MercadolibreProductDetail,
    itemIds: string[],
  ): Promise<ChildManagement[]> {
    const previous = await this.childrenRepository.findByProductId(product.id);
    const previousByItem = childrenByItemId(previous);
    const staleItemIds = itemIds.filter(
      (itemId) => !isFresh(previousByItem.get(itemId)?.management_synced_at),
    );
    if (staleItemIds.length === 0) return storedChildren(previous, itemIds);

    await this.refreshTargets(product.id, staleItemIds);
    const current = await this.childrenRepository.findByProductId(product.id);
    return storedChildren(mergeChildren(previous, current), itemIds);
  }

  private async refreshTargets(productId: string, itemIds: string[]) {
    for (const itemId of itemIds) {
      try {
        const context = await this.targets.resolve(productId, itemId);
        const item = await this.targets.getOwnedItem(context, true);
        await this.snapshots.persist(context.target, item);
      } catch {
        // Conserva el ultimo snapshot guardado para este target.
      }
    }
  }
}

function storedSharedManagement(
  product: MercadolibreProductDetail,
  itemIds: string[],
): SharedManagement {
  return {
    itemIds,
    status: product.status,
    pictures: product.pictures,
    sku: storedItemSku(product.shared_skus),
    sharedSkus: product.shared_skus,
    refreshedAt: product.management_synced_at,
  };
}

function storedChildren(
  children: MercadolibreChildRow[],
  itemIds: string[],
): ChildManagement[] {
  const byItemId = childrenByItemId(children);
  return itemIds.flatMap((itemId) => {
    const child = byItemId.get(itemId);
    return child ? [storedChildManagement(child)] : [];
  });
}

function storedChildManagement(child: MercadolibreChildRow): ChildManagement {
  return {
    itemId: child.item_id,
    status: child.status,
    pictures: child.pictures,
    sku: sellerSku(parseLiveAttributes(child.attributes)),
    refreshedAt: child.management_synced_at,
  };
}

function mergeChildren(
  previous: MercadolibreChildRow[],
  current: MercadolibreChildRow[],
): MercadolibreChildRow[] {
  return [...childrenByItemId(previous), ...childrenByItemId(current)].map(
    ([, child]) => child,
  );
}

function childrenByItemId(children: MercadolibreChildRow[]) {
  return new Map(children.map((child) => [child.item_id, child]));
}

function storedItemSku(value: unknown): string | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const sku = (value as Record<string, unknown>).__item__;
  return typeof sku === 'string' ? sku : null;
}

function isFresh(value: string | null | undefined): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Date.now() - timestamp < SNAPSHOT_TTL_MS;
}
