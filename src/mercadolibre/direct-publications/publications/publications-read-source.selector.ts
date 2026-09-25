import { MercadoLibrePublicationsReadSource } from './mercadolibre-publications-read-source';
import { PublicationsReadSource } from './publications-read-source';
import { SupabasePublicationsReadSource } from './supabase-publications-read-source';

export function selectPublicationsReadSource(
  configuredValue: string | undefined,
  mercadoLibre: MercadoLibrePublicationsReadSource,
  supabase: SupabasePublicationsReadSource,
): PublicationsReadSource {
  const source = configuredValue ?? 'mercadolibre';
  if (source === 'mercadolibre') return mercadoLibre;
  if (source === 'supabase') return supabase;
  throw new Error('PUBLICATIONS_READ_SOURCE debe ser mercadolibre o supabase');
}
