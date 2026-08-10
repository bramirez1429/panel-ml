import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import {
  MercadolibreProductDetail,
  MercadolibreProductRow,
  MercadolibreProductUpsert,
  ProductsPage,
} from './mercadolibre-publications.types';

const WRITE_CHUNK_SIZE = 200;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_COLUMNS =
  'id,seller_id,external_key,model,family_id,parent_item_id,family_name,title,thumbnail,status,category_id,currency_id,price_from,price_to,stock_total,children_count,permalink,source_updated_at,last_synced_at,updated_at';
const DETAIL_COLUMNS =
  'id,seller_id,external_key,model,family_id,parent_item_id,family_name,title,thumbnail,status,category_id,currency_id,price_from,price_to,stock_total,children_count,permalink,source_updated_at,last_synced_at,updated_at,shared_variations,created_at';

@Injectable()
export class MercadolibreProductsRepository {
  /** Recibe el cliente compartido de Supabase. */
  constructor(private readonly supabaseService: SupabaseService) {}

  /** Devuelve una página ordenada y su total exacto. */
  async findPage(
    sellerId: number,
    page: number,
    limit: number,
  ): Promise<ProductsPage> {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, error, count } = await this.supabaseService
      .getClient()
      .from('mercadolibre_products')
      .select(LIST_COLUMNS, { count: 'exact' })
      .eq('seller_id', sellerId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);

    if (error || !data || count === null) this.readError();
    return {
      products: data,
      total: count,
    };
  }

  /** Busca un producto por UUID dentro del vendedor. */
  async findById(
    sellerId: number,
    id: string,
  ): Promise<MercadolibreProductDetail | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_products')
      .select(DETAIL_COLUMNS)
      .eq('seller_id', sellerId)
      .eq('id', id)
      .maybeSingle();

    if (error) this.readError();
    return data;
  }

  /** Busca un producto por su clave estable dentro del vendedor. */
  async findByExternalKey(
    sellerId: number,
    externalKey: string,
  ): Promise<MercadolibreProductDetail | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_products')
      .select(DETAIL_COLUMNS)
      .eq('seller_id', sellerId)
      .eq('external_key', externalKey)
      .maybeSingle();

    if (error) this.readError();
    return data;
  }

  /** Inserta o actualiza un producto por vendedor y clave externa. */
  async upsert(
    product: MercadolibreProductUpsert,
  ): Promise<MercadolibreProductRow> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_products')
      .upsert(
        { ...product, updated_at: new Date().toISOString() },
        {
          onConflict: 'seller_id,external_key',
          defaultToNull: false,
        },
      )
      .select('*')
      .single();

    if (error || !data) this.writeError();
    return data;
  }

  /** Marca las claves vistas en una sincronización completa. */
  async markFullSync(
    sellerId: number,
    externalKeys: string[],
    syncId: string,
  ): Promise<void> {
    if (externalKeys.length === 0) return;
    this.validateSyncId(syncId);
    const timestamp = new Date().toISOString();

    for (const keys of chunk(externalKeys, WRITE_CHUNK_SIZE)) {
      const { error } = await this.supabaseService
        .getClient()
        .from('mercadolibre_products')
        .update({
          last_full_sync_id: syncId,
          last_synced_at: timestamp,
          updated_at: timestamp,
        })
        .eq('seller_id', sellerId)
        .in('external_key', keys);
      if (error) this.syncError();
    }
  }

  /** Borra productos ausentes de una sincronización completa. */
  async deleteNotSeenInFullSync(
    sellerId: number,
    syncId: string,
    syncStartedAt: string,
  ): Promise<void> {
    this.validateSyncId(syncId);
    if (!Number.isFinite(Date.parse(syncStartedAt))) this.syncError();
    const { error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_products')
      .delete()
      .eq('seller_id', sellerId)
      .lt('last_synced_at', syncStartedAt)
      .or(`last_full_sync_id.is.null,last_full_sync_id.neq.${syncId}`);

    if (error) this.deleteError();
  }

  /** Borra claves externas concretas sin afectar otros vendedores. */
  async deleteByExternalKeys(
    sellerId: number,
    externalKeys: string[],
  ): Promise<void> {
    if (externalKeys.length === 0) return;

    for (const keys of chunk(externalKeys, WRITE_CHUNK_SIZE)) {
      const { error } = await this.supabaseService
        .getClient()
        .from('mercadolibre_products')
        .delete()
        .eq('seller_id', sellerId)
        .in('external_key', keys);
      if (error) this.deleteError();
    }
  }

  /** Evita interpolar un identificador inválido en el filtro OR. */
  private validateSyncId(syncId: string): void {
    if (!UUID_PATTERN.test(syncId)) this.syncError();
  }

  /** Informa un fallo de lectura sin filtrar datos internos. */
  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron leer los productos de Mercado Libre',
    );
  }

  /** Informa un fallo de escritura sin filtrar datos internos. */
  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar el producto de Mercado Libre',
    );
  }

  /** Informa un fallo de sincronización sin filtrar datos internos. */
  private syncError(): never {
    throw new ServiceUnavailableException(
      'No se pudo marcar la sincronización de Mercado Libre',
    );
  }

  /** Informa un fallo al borrar sin filtrar datos internos. */
  private deleteError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron eliminar productos de Mercado Libre',
    );
  }
}

/** Divide una lista para limitar cada escritura. */
function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
