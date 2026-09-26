begin;

create table if not exists public.mercadolibre_sync_errors (
  id uuid primary key default gen_random_uuid(),
  sync_job_id uuid references public.mercadolibre_sync_jobs(id) on delete cascade,
  seller_id bigint not null,
  item_id text not null,
  family_id text,
  error_type text not null,
  error_code text,
  error_message text not null,
  attempts integer not null default 1,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint mercadolibre_sync_errors_type_check check (error_type in (
    'PUBLICATION_ERROR',
    'VALIDATION_ERROR',
    'AUTH_ERROR',
    'RATE_LIMIT',
    'PROVIDER_TEMPORARY_ERROR',
    'POSSIBLE_API_CHANGE',
    'MIRROR_WRITE_FAILED'
  )),
  constraint mercadolibre_sync_errors_status_check
    check (status in ('OPEN', 'RETRYING', 'RESOLVED')),
  constraint mercadolibre_sync_errors_attempts_check check (attempts > 0)
);

create index if not exists mercadolibre_sync_errors_job_status_idx
  on public.mercadolibre_sync_errors (sync_job_id, status);
create index if not exists mercadolibre_sync_errors_seller_status_idx
  on public.mercadolibre_sync_errors (seller_id, status, created_at desc);
create index if not exists mercadolibre_sync_errors_item_idx
  on public.mercadolibre_sync_errors (item_id);

alter table public.mercadolibre_sync_errors enable row level security;

commit;
