import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';

export type MercadoLibreConnection = {
  user_id: string;
  seller_id: number;
  nickname: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  updated_at: string;
};

export type MercadoLibreOAuthTransaction = {
  stateHash: string;
  userId: string;
  refreshSessionId: string;
  browserBindingHash: string;
  expiresAt: string;
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
      .upsert(connection, { onConflict: 'user_id' });

    if (error) {
      throw new ServiceUnavailableException(
        'No se pudo guardar la conexión de Mercado Libre',
      );
    }
  }

  /** Registra un inicio OAuth sólo si la sesión autenticada sigue vigente. */
  async createMercadoLibreOAuthTransaction(
    transaction: MercadoLibreOAuthTransaction,
  ): Promise<boolean> {
    const { data, error } = await this.getClient().rpc(
      'create_mercadolibre_oauth_transaction',
      {
        p_state_hash: transaction.stateHash,
        p_user_id: transaction.userId,
        p_refresh_session_id: transaction.refreshSessionId,
        p_browser_binding_hash: transaction.browserBindingHash,
        p_expires_at: transaction.expiresAt,
      },
    );

    if (error) {
      throw new ServiceUnavailableException(
        'No se pudo iniciar la autorización de Mercado Libre',
      );
    }
    return data === true;
  }

  /** Consume exactamente una vez la transacción OAuth y su sesión. */
  async consumeMercadoLibreOAuthTransaction(input: {
    stateHash: string;
    userId: string;
    browserBindingHash: string;
  }): Promise<boolean> {
    const { data, error } = await this.getClient().rpc(
      'consume_mercadolibre_oauth_transaction',
      {
        p_state_hash: input.stateHash,
        p_user_id: input.userId,
        p_browser_binding_hash: input.browserBindingHash,
      },
    );

    if (error) {
      throw new ServiceUnavailableException(
        'No se pudo validar la autorización de Mercado Libre',
      );
    }
    return data === true;
  }

  /** Reemplaza tokens solo si la conexion no cambio durante el refresh. */
  async saveRefreshedConnection(
    connection: MercadoLibreConnection,
    previousUpdatedAt: string,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const { data, error } = await this.getClient()
          .from('mercadolibre_tokens')
          .update({
            nickname: connection.nickname,
            access_token: connection.access_token,
            refresh_token: connection.refresh_token,
            expires_at: connection.expires_at,
            updated_at: connection.updated_at,
          })
          .eq('user_id', connection.user_id)
          .eq('seller_id', connection.seller_id)
          .eq('updated_at', previousUpdatedAt)
          .select('user_id')
          .maybeSingle();

        if (!error) return data !== null;
      } catch {
        // Reintenta: la respuesta puede haberse perdido tras aplicar el CAS.
      }
    }
    throw new ServiceUnavailableException(
      'No se pudo actualizar la conexion de Mercado Libre',
    );
  }

  /** Devuelve solamente la conexión del usuario indicado. */
  async getConnection(userId: string): Promise<MercadoLibreConnection | null> {
    const { data, error } = await this.getClient()
      .from('mercadolibre_tokens')
      .select(
        'user_id,seller_id,nickname,access_token,refresh_token,expires_at,updated_at',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new ServiceUnavailableException(
        'No se pudo leer la conexión de Mercado Libre',
      );
    }

    return data;
  }

  async deleteConnection(userId: string): Promise<void> {
    const { error } = await this.getClient()
      .from('mercadolibre_tokens')
      .delete()
      .eq('user_id', userId);
    if (error)
      throw new ServiceUnavailableException(
        'No se pudo desconectar Mercado Libre',
      );
  }

  /** Resuelve una conexión por seller para procesos originados por Mercado Libre. */
  async getConnectionBySellerId(
    sellerId: number,
  ): Promise<MercadoLibreConnection | null> {
    const { data, error } = await this.getClient()
      .from('mercadolibre_tokens')
      .select(
        'user_id,seller_id,nickname,access_token,refresh_token,expires_at,updated_at',
      )
      .eq('seller_id', sellerId)
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
