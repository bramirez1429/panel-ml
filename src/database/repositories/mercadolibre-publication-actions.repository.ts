import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '../database.types';
import { SupabaseService } from '../supabase.service';
import type { PublicationActionInsert } from '../../mercadolibre/publications/activity/publication-activity.types';

type ActionRow =
  Database['public']['Tables']['mercadolibre_publication_actions']['Row'];

const COLUMNS =
  'id,seller_id,product_id,item_id,action,status,old_value,new_value,error_message,created_at';

@Injectable()
export class MercadolibrePublicationActionsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  /** Inserta una accion de publicacion ya sanitizada. */
  async insert(input: PublicationActionInsert): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_publication_actions')
      .insert({
        seller_id: input.sellerId,
        product_id: input.productId,
        item_id: input.itemId,
        action: input.action,
        status: input.status,
        old_value: input.oldValue,
        new_value: input.newValue,
        error_message: input.errorMessage,
      });
    if (error) this.writeError();
  }

  /** Lista las acciones recientes dentro del seller y producto indicados. */
  async findRecent(
    sellerId: number,
    productId: string,
    itemId: string | null,
    limit = 30,
  ): Promise<ActionRow[]> {
    let query = this.supabaseService
      .getClient()
      .from('mercadolibre_publication_actions')
      .select(COLUMNS)
      .eq('seller_id', sellerId)
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (itemId) query = query.eq('item_id', itemId);
    const { data, error } = await query;
    if (error || !data) this.readError();
    return data;
  }

  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudo leer la actividad de publicaciones',
    );
  }

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar la actividad de publicaciones',
    );
  }
}
