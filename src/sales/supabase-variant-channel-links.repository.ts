import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { VariantChannelLinkRow } from '../database/database.types';
import { SupabaseService } from '../database/supabase.service';
import type { SaveVariantChannelLink, VariantChannelLink } from './sales.types';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

@Injectable()
export class SupabaseVariantChannelLinksRepository extends VariantChannelLinksRepository {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async findByUserId(userId: string): Promise<VariantChannelLink[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('variant_channel_links')
      .select('*')
      .eq('user_id', userId);
    if (error || !data) this.readError();
    return data.map(mapLink);
  }

  async save(link: SaveVariantChannelLink): Promise<VariantChannelLink> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabase
      .getClient()
      .from('variant_channel_links')
      .upsert(
        {
          user_id: link.userId,
          ml_item_id: link.mlItemId,
          ml_variation_id: link.mlVariationId,
          user_product_id: link.userProductId,
          family_id: link.familyId,
          tn_product_id: link.tnProductId,
          tn_variant_id: link.tnVariantId,
          sku: link.sku,
          normalized_color: link.normalizedColor,
          normalized_size: link.normalizedSize,
          match_source: link.matchSource,
          updated_at: timestamp,
        },
        { onConflict: 'user_id,tn_product_id,tn_variant_id' },
      )
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'Una de las variantes ya está vinculada a otra variante',
        );
      }
      this.writeError();
    }
    if (!data) this.writeError();
    return mapLink(data);
  }

  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron leer los vínculos de variantes',
    );
  }

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar el vínculo de variantes',
    );
  }
}

function mapLink(row: VariantChannelLinkRow): VariantChannelLink {
  return {
    id: row.id,
    userId: row.user_id,
    mlItemId: row.ml_item_id,
    mlVariationId: row.ml_variation_id,
    userProductId: row.user_product_id,
    familyId: row.family_id,
    tnProductId: row.tn_product_id,
    tnVariantId: row.tn_variant_id,
    sku: row.sku,
    normalizedColor: row.normalized_color,
    normalizedSize: row.normalized_size,
    matchSource: row.match_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
