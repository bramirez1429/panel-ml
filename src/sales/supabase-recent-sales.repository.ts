import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { RecentSaleRow } from '../database/database.types';
import { SupabaseService } from '../database/supabase.service';
import { RecentSalesRepository } from './recent-sales.repository';
import type { RecentSale, SaveRecentSale } from './sales.types';

@Injectable()
export class SupabaseRecentSalesRepository extends RecentSalesRepository {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async saveMany(sales: readonly SaveRecentSale[]): Promise<void> {
    if (sales.length === 0) return;
    const updatedAt = new Date().toISOString();
    const rows = sales.map((sale) => toInsert(sale, updatedAt));
    const { error } = await this.supabase
      .getClient()
      .from('recent_sales')
      .upsert(rows, {
        onConflict: 'user_id,channel,external_order_id,external_order_item_id',
      });
    if (error) this.writeError();
  }

  async findSince(since: Date): Promise<RecentSale[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('recent_sales')
      .select('*')
      .gte('sold_at', since.toISOString())
      .order('sold_at', { ascending: false });
    if (error || !data) this.readError();
    return data.map(mapSale);
  }

  async findById(saleId: string): Promise<RecentSale | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('recent_sales')
      .select('*')
      .eq('id', saleId)
      .maybeSingle();
    if (error) this.readError();
    return data ? mapSale(data) : null;
  }

  private readError(): never {
    throw new ServiceUnavailableException('No se pudieron leer las ventas');
  }

  private writeError(): never {
    throw new ServiceUnavailableException('No se pudo registrar la venta');
  }
}

function toInsert(sale: SaveRecentSale, updatedAt: string) {
  return {
    user_id: sale.userId,
    channel: sale.channel,
    external_order_id: sale.externalOrderId,
    external_order_item_id: sale.externalOrderItemId,
    sold_at: sale.soldAt,
    quantity: sale.quantity,
    product_name: sale.productName,
    sku: sale.sku,
    ml_item_id: sale.mlItemId,
    ml_variation_id: sale.mlVariationId,
    user_product_id: sale.userProductId,
    family_id: sale.familyId,
    tn_product_id: sale.tnProductId,
    tn_variant_id: sale.tnVariantId,
    color: sale.color,
    size: sale.size,
    mapping_status: sale.mappingStatus,
    updated_at: updatedAt,
  };
}

function mapSale(row: RecentSaleRow): RecentSale {
  return {
    id: row.id,
    userId: row.user_id,
    channel: row.channel,
    externalOrderId: row.external_order_id,
    externalOrderItemId: row.external_order_item_id,
    soldAt: row.sold_at,
    quantity: row.quantity,
    productName: row.product_name,
    sku: row.sku,
    mlItemId: row.ml_item_id,
    mlVariationId: row.ml_variation_id,
    userProductId: row.user_product_id,
    familyId: row.family_id,
    tnProductId: row.tn_product_id,
    tnVariantId: row.tn_variant_id,
    color: row.color,
    size: row.size,
    mappingStatus: row.mapping_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
