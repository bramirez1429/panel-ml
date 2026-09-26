begin;

create table if not exists public.mercadolibre_integration_events (
  id uuid primary key default gen_random_uuid(),
  seller_id bigint,
  event_type text not null,
  endpoint text not null,
  http_method text,
  http_status integer,
  provider_code text,
  message text not null,
  fingerprint text not null,
  occurrences integer not null default 1,
  status text not null default 'OPEN',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb,
  constraint mercadolibre_integration_events_type_check check (event_type in (
    'POSSIBLE_API_CHANGE',
    'SCHEMA_MISMATCH',
    'UNKNOWN_PROVIDER_ERROR',
    'PROVIDER_BEHAVIOR_CHANGE'
  )),
  constraint mercadolibre_integration_events_status_check
    check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  constraint mercadolibre_integration_events_occurrences_check
    check (occurrences > 0)
);

create unique index if not exists mercadolibre_integration_events_open_fingerprint
  on public.mercadolibre_integration_events (fingerprint)
  where status = 'OPEN';
create index if not exists mercadolibre_integration_events_seller_status_idx
  on public.mercadolibre_integration_events (seller_id, status, last_seen_at desc);

alter table public.mercadolibre_integration_events enable row level security;

create or replace function public.record_mercadolibre_integration_event(
  p_seller_id bigint,
  p_event_type text,
  p_endpoint text,
  p_http_method text,
  p_http_status integer,
  p_provider_code text,
  p_message text,
  p_fingerprint text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_fingerprint, 0));

  update public.mercadolibre_integration_events
  set
    occurrences = occurrences + 1,
    last_seen_at = now(),
    seller_id = coalesce(p_seller_id, seller_id),
    http_status = coalesce(p_http_status, http_status),
    provider_code = coalesce(p_provider_code, provider_code),
    metadata = coalesce(p_metadata, metadata)
  where fingerprint = p_fingerprint
    and status = 'OPEN'
  returning id into event_id;

  if event_id is null then
    insert into public.mercadolibre_integration_events (
      seller_id,
      event_type,
      endpoint,
      http_method,
      http_status,
      provider_code,
      message,
      fingerprint,
      metadata
    ) values (
      p_seller_id,
      p_event_type,
      p_endpoint,
      p_http_method,
      p_http_status,
      p_provider_code,
      p_message,
      p_fingerprint,
      p_metadata
    )
    returning id into event_id;
  end if;

  return event_id;
end;
$$;

revoke all on function public.record_mercadolibre_integration_event(
  bigint, text, text, text, integer, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_mercadolibre_integration_event(
  bigint, text, text, text, integer, text, text, text, jsonb
) to service_role;

commit;
