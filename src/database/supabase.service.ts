import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';

export type MercadoLibreConnection = {
  seller_id: number;
  nickname: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
};

@Injectable()
export class SupabaseService {
  private client?: SupabaseClient<Database>;

  /** Recibe la configuración privada del servidor. */
  constructor(private readonly configService: ConfigService) {}

  /** Guarda o actualiza la conexión de Mercado Libre. */
  async saveConnection(connection: MercadoLibreConnection): Promise<void> {
    const { error } = await this.getClient()
      .from('mercadolibre_tokens')
      .upsert(connection, { onConflict: 'seller_id' });

    if (error) {
      throw new ServiceUnavailableException(
        'No se pudo guardar la conexión de Mercado Libre',
      );
    }
  }

  /** Devuelve la conexión guardada o null si todavía no existe. */
  async getConnection(): Promise<MercadoLibreConnection | null> {
    const { data, error } = await this.getClient()
      .from('mercadolibre_tokens')
      .select(
        'seller_id,nickname,access_token,refresh_token,expires_at,updated_at',
      )
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new ServiceUnavailableException(
        'No se pudo leer la conexión de Mercado Libre',
      );
    }

    return data;
  }

  /** Crea el cliente de Supabase solamente cuando se necesita. */
  getClient(): SupabaseClient<Database> {
    if (!this.client) {
      this.client = createClient<Database>(
        this.requiredConfig('SUPABASE_URL'),
        this.requiredConfig('SUPABASE_SERVICE_ROLE_KEY'),
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    }
    return this.client;
  }

  /** Lee una variable obligatoria sin mostrar su contenido. */
  private requiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(
        'La conexión con Supabase no está configurada',
      );
    }
    return value;
  }
}
