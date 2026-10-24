import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { SupabaseService } from '../../../database/supabase.service';
import type {
  MercadolibreChildRow,
  MercadolibreProductRow,
} from '../../../database/repositories/mercadolibre-publications.types';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { PromotionCatalogRow } from './promotions-catalog.types';
import type { PromotionProductGroup } from './promotions-product-group';

const DB_PAGE_SIZE = 1000;
const PRODUCT_BATCH_SIZE = 50;
const PRODUCT_COLUMNS = 'id,model,family_id,parent_item_id,family_name,title,thumbnail,status,price_from,stock_total';
const CHILD_COLUMNS = 'product_id,item_id,variant_label,title,thumbnail,status,price,available_quantity,attributes';

type CachedProduct = Pick<MercadolibreProductRow,
  'id' | 'model' | 'family_id' | 'parent_item_id' | 'family_name' |
  'title' | 'thumbnail' | 'status' | 'price_from' | 'stock_total'
>;
type CachedChild = Pick<MercadolibreChildRow,
  'product_id' | 'item_id' | 'variant_label' | 'title' | 'thumbnail' |
  'status' | 'price' | 'available_quantity' | 'attributes'
>;

/**
 * Reads the complete, already-synced publication inventory from Supabase.
 * No Mercado Libre API calls or per-MLA promotion calls are made here.
 */
@Injectable()
export class PromotionsSnapshotService {
  constructor(
    private readonly tokens: MercadolibreTokenService,
    private readonly database: SupabaseService,
  ) {}

  async getSnapshot(userId: string) {
    const connection = await this.tokens.getStoredConnection(userId);
    const sellerId = connection.seller_id;
    const products = await this.readProducts(sellerId);
    const familyProducts = products.filter((product) => product.model === 'VARIANT_PRICING');
    const children = await this.readChildren(familyProducts.map(({ id }) => id));
    const childrenByProduct = new Map<string, CachedChild[]>();
    for (const child of children) {
      const siblings = childrenByProduct.get(child.product_id) ?? [];
      siblings.push(child);
      childrenByProduct.set(child.product_id, siblings);
    }

    const publications: PromotionCatalogRow[] = [];
    for (const product of products) {
      const group = productGroupOf(product.title, product.family_name);
      if (!group) continue;

      if (product.model === 'SHARED' && product.parent_item_id) {
        publications.push(toRow({
          itemId: product.parent_item_id,
          familyId: null,
          title: product.title,
          thumbnail: product.thumbnail,
          price: product.price_from,
          stock: product.stock_total,
          productGroup: group,
        }));
      } else if (product.model === 'VARIANT_PRICING') {
        for (const child of childrenByProduct.get(product.id) ?? []) {
          if (!/^MLA\d+$/u.test(child.item_id)) continue;
          const { color, size } = childAttributes(child.attributes);
          publications.push(toRow({
            itemId: child.item_id,
            familyId: product.family_id,
            title: child.title || child.variant_label || product.title,
            thumbnail: child.thumbnail || product.thumbnail,
            price: child.price ?? product.price_from,
            stock: child.available_quantity,
            productGroup: group,
            variantColor: color,
            variantSize: size,
          }));
        }
      }
    }

    return {
      publications,
      done: true,
      nextCursor: null,
      count: publications.length,
    };
  }

  private async readProducts(sellerId: number): Promise<CachedProduct[]> {
    const products: CachedProduct[] = [];
    for (let start = 0; ; start += DB_PAGE_SIZE) {
      const { data, error } = await this.database.getClient()
        .from('mercadolibre_products')
        .select(PRODUCT_COLUMNS)
        .eq('seller_id', sellerId)
        .order('id', { ascending: true })
        .range(start, start + DB_PAGE_SIZE - 1);
      if (error || !data) throw new ServiceUnavailableException('No se pudo cargar el catálogo sincronizado');
      products.push(...data);
      if (data.length < DB_PAGE_SIZE) break;
    }
    return products;
  }

  private async readChildren(productIds: readonly string[]): Promise<CachedChild[]> {
    const children: CachedChild[] = [];
    for (let index = 0; index < productIds.length; index += PRODUCT_BATCH_SIZE) {
      const batch = productIds.slice(index, index + PRODUCT_BATCH_SIZE);
      for (let start = 0; ; start += DB_PAGE_SIZE) {
        const { data, error } = await this.database.getClient()
          .from('mercadolibre_product_children')
          .select(CHILD_COLUMNS)
          .in('product_id', batch)
          .order('item_id', { ascending: true })
          .range(start, start + DB_PAGE_SIZE - 1);
        if (error || !data) throw new ServiceUnavailableException('No se pudieron cargar los talles sincronizados');
        children.push(...data);
        if (data.length < DB_PAGE_SIZE) break;
      }
    }
    return children;
  }
}

function toRow(input: {
  itemId: string; familyId: string | null; title: string;
  thumbnail: string | null; price: number | null; stock: number | null;
  productGroup: PromotionProductGroup;
  variantColor?: string | null; variantSize?: string | null;
}): PromotionCatalogRow {
  return {
    itemId: input.itemId,
    familyId: input.familyId,
    title: input.title,
    thumbnail: input.thumbnail,
    sku: null,
    variantColor: input.variantColor ?? null,
    variantSize: input.variantSize ?? null,
    stock: input.stock,
    freeShipping: null,
    installmentLabel: null,
    productGroup: input.productGroup,
    price: input.price ?? 0,
    currentPromotion: null,
    hasActivePromotion: null,
    availablePromotionsCount: null,
    promotionStatus: null,
  };
}

export function productGroupOf(
  title: string,
  familyName: string | null,
): PromotionProductGroup | null {
  const value = (title + ' ' + (familyName ?? ''))
    .normalize('NFD').replace(/\p{M}+/gu, '').toUpperCase();
  const garment = /\b(BUZO|BUZOS|SUDADERA|HOODIE|SWEATSHIRT)\b/u.test(value)
    ? 'SWEATSHIRT'
    : /\b(REMERA|REMERAS|CAMISETA|TSHIRT|T-SHIRT)\b/u.test(value)
      ? 'TSHIRT' : null;
  if (!garment) return null;
  const audience = /\b(NINA|NINAS|NENA|NENAS|INFANTIL|KIDS|GIRLS)\b/u.test(value)
    ? 'GIRLS' : 'WOMEN';
  return (audience + '_' + garment) as PromotionProductGroup;
}

function childAttributes(attributes: unknown): { color: string | null; size: string | null } {
  if (!Array.isArray(attributes)) return { color: null, size: null };
  let color: string | null = null;
  let size: string | null = null;
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== 'object') continue;
    const source = attribute as Record<string, unknown>;
    const id = String(source.id ?? '').toUpperCase().replace(/[^A-Z]/gu, '');
    const value = source.valueName ?? source.value_name;
    if (typeof value !== 'string' || !value.trim()) continue;
    if (id === 'COLOR' || id === 'MAINCOLOR') color = value.trim();
    if (id === 'SIZE' || id === 'SIZENAME') size = value.trim();
  }
  return { color, size };
}
