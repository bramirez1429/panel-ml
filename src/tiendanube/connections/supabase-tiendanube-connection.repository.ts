import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { SupabaseService } from '../../database/supabase.service';
import {
  SaveTiendanubeConnectionInput,
  TiendanubeConnectionRepository,
  TiendanubeConnectionSummary,
} from './tiendanube-connection.repository';

@Injectable()
export class SupabaseTiendanubeConnectionRepository extends TiendanubeConnectionRepository {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async saveConnection(input: SaveTiendanubeConnectionInput): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .upsert(
          {
            user_id: input.userId,
            store_id: input.storeId,
            access_token: input.accessToken,
            token_type: input.tokenType,
            scope: input.scope,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id', defaultToNull: false },
        );

      if (!error) return;
    } catch {
      // Los detalles de Supabase pueden contener credenciales y no se propagan.
    }

    this.writeError();
  }

  async findSummaryByUserId(
    userId: string,
  ): Promise<TiendanubeConnectionSummary | null> {
    const { data, error } = await this.readSummaryRow(userId);

    if (error) this.readError();
    if (!data) return null;

    return {
      storeId: data.store_id,
      scope: data.scope,
    };
  }

  async deleteByStoreId(storeId: string): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .delete()
        .eq('store_id', storeId);

      if (!error) return;
    } catch {
      // Los detalles de Supabase pueden contener credenciales y no se propagan.
    }

    throw new ServiceUnavailableException(
      'No se pudo eliminar la conexión de Tiendanube',
    );
  }

  private async readSummaryRow(userId: string) {
    try {
      return await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .select('store_id,scope')
        .eq('user_id', userId)
        .maybeSingle();
    } catch {
      this.readError();
    }
  }

  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudo leer la conexión de Tiendanube',
    );
  }

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar la conexión de Tiendanube',
    );
  }
}
