import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { IntegrationEventType, Json } from '../database.types';
import { SupabaseService } from '../supabase.service';

export type RecordIntegrationEventInput = Readonly<{
  sellerId: number | null;
  eventType: IntegrationEventType;
  endpoint: string;
  httpMethod?: string | null;
  httpStatus?: number | null;
  providerCode?: string | null;
  message: string;
  fingerprint: string;
  metadata?: Json | null;
}>;

@Injectable()
export class MercadolibreIntegrationEventsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async record(input: RecordIntegrationEventInput): Promise<string> {
    const { data, error } = await this.supabaseService
      .getClient()
      .rpc('record_mercadolibre_integration_event', {
        p_seller_id: input.sellerId,
        p_event_type: input.eventType,
        p_endpoint: input.endpoint,
        p_http_method: input.httpMethod ?? null,
        p_http_status: input.httpStatus ?? null,
        p_provider_code: input.providerCode ?? null,
        p_message: input.message.slice(0, 500),
        p_fingerprint: input.fingerprint,
        p_metadata: input.metadata ?? null,
      });
    if (error || !data) this.writeError();
    return data;
  }

  async countOpen(sellerId: number): Promise<number> {
    const { count, error } = await this.supabaseService
      .getClient()
      .from('mercadolibre_integration_events')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('status', 'OPEN');
    if (error || count === null) this.readError();
    return count;
  }

  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron leer los eventos de integración',
    );
  }

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar el evento de integración',
    );
  }
}
