import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import {
  MercadolibreChildRow,
  MercadolibreChildUpsert,
} from './mercadolibre-publications.types';

const READ_PAGE_SIZE = 1_000;
const WRITE_CHUNK_SIZE = 200;

@Injectable()
export class MercadolibreChildrenRepository {
  /** Recibe el cliente compartido de Supabase. */
  constructor(private readonly supabaseService: SupabaseService) {}

  /** Devuelve todos los hijos de un producto usando páginas internas. */
  async findByProductId(productId: string): Promise<MercadolibreChildRow[]> {
    const children: MercadolibreChildRow[] = [];

    for (let from = 0; ; from += READ_PAGE_SIZE) {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('mercadolibre_product_children')
        .select('*')
        .eq('product_id', productId)
        .order('item_id', { ascending: true })
        .range(from, from + READ_PAGE_SIZE - 1);

      if (error || !data) this.readError();
      children.push(...data);
      if (data.length < READ_PAGE_SIZE) return children;
    }
  }

  /** Guarda hijos en lotes sin convertir campos omitidos en null. */
  async upsertMany(children: MercadolibreChildUpsert[]): Promise<void> {
    if (children.length === 0) return;

    for (const batch of chunk(children, WRITE_CHUNK_SIZE)) {
      const timestamp = new Date().toISOString();
      const rows = batch.map((child) => ({
        ...child,
        updated_at: timestamp,
      }));
      const { error } = await this.supabaseService
        .getClient()
        .from('mercadolibre_product_children')
        .upsert(rows, { onConflict: 'item_id', defaultToNull: false });

      if (error) this.writeError();
    }
  }

  /** Borra hijos que ya no pertenecen al producto. */
  async deleteMissingChildren(
    productId: string,
    currentItemIds: string[],
  ): Promise<void> {
    if (currentItemIds.length === 0) {
      await this.deleteByProductId(productId);
      return;
    }

    const current = new Set(currentItemIds);
    const stored = await this.findByProductId(productId);
    const missing = stored
      .map((child) => child.item_id)
      .filter((itemId) => !current.has(itemId));

    for (const itemIds of chunk(missing, WRITE_CHUNK_SIZE)) {
      const { error } = await this.supabaseService
        .getClient()
        .from('mercadolibre_product_children')
        .delete()
        .eq('product_id', productId)
        .in('item_id', itemIds);
      if (error) this.deleteError();
    }
  }

  /** Borra todos los hijos de un producto. */
  async deleteByProductId(productId: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_product_children')
      .delete()
      .eq('product_id', productId);

    if (error) this.deleteError();
  }

  /** Borra un hijo por el item_id único de Mercado Libre. */
  async deleteByItemId(itemId: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_product_children')
      .delete()
      .eq('item_id', itemId);

    if (error) this.deleteError();
  }

  /** Informa un fallo de lectura sin filtrar datos internos. */
  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron leer los hijos de Mercado Libre',
    );
  }

  /** Informa un fallo de escritura sin filtrar datos internos. */
  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron guardar los hijos de Mercado Libre',
    );
  }

  /** Informa un fallo al borrar sin filtrar datos internos. */
  private deleteError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron eliminar hijos de Mercado Libre',
    );
  }


  /** Actualiza el precio de un hijo por MLA. */
async updatePrice(itemId: string, price: number): Promise<void> {
  const { error } = await this.supabaseService
    .getClient()
    .from('mercadolibre_product_children')
    .update({
      price,
      updated_at: new Date().toISOString(),
    })
    .eq('item_id', itemId);

  if (error) {
    throw new ServiceUnavailableException(
      'No se pudo actualizar el precio de la variante',
    );
  }
}

/** Actualiza el stock de un hijo por MLA. */
async updateStock(itemId: string, stock: number): Promise<void> {
  const { error } = await this.supabaseService
    .getClient()
    .from('mercadolibre_product_children')
    .update({
      available_quantity: stock,
      updated_at: new Date().toISOString(),
    })
    .eq('item_id', itemId);

  if (error) {
    throw new ServiceUnavailableException(
      'No se pudo actualizar el stock de la variante',
    );
  }
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
