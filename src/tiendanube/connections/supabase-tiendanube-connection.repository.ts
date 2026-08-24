import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { SupabaseService } from '../../database/supabase.service';
import {
  SaveTiendanubeConnectionInput,
  TiendanubeConnectionRepository,
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

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar la conexión de Tiendanube',
    );
  }
}
