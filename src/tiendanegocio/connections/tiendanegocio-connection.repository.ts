import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../database/supabase.service';

type ConnectionRow = Readonly<{
  user_id: string;
  store_id: string;
  access_token: string;
  scope: string;
}>;

@Injectable()
export class TiendaNegocioConnectionRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async get(userId: string): Promise<ConnectionRow | null> {
    const { data, error } = await this.client()
      .from('tiendanegocio_connections')
      .select('user_id,store_id,access_token,scope')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw this.unavailable();
    return data as ConnectionRow | null;
  }

  async save(connection: ConnectionRow): Promise<void> {
    const { error } = await this.client()
      .from('tiendanegocio_connections')
      .upsert({
        user_id: connection.user_id,
        store_id: connection.store_id,
        access_token: connection.access_token,
        scope: connection.scope,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) throw this.unavailable();
  }

  async disconnect(userId: string): Promise<void> {
    const { error } = await this.client()
      .from('tiendanegocio_connections')
      .delete()
      .eq('user_id', userId);
    if (error) throw this.unavailable();
  }

  private client(): SupabaseClient {
    return this.supabase.getClient() as unknown as SupabaseClient;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException('No se pudo consultar la conexión de Tienda Negocio');
  }
}
