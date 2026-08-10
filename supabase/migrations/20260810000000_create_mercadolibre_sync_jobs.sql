create table if not exists public.mercadolibre_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  seller_id bigint not null,
  full_sync_id uuid not null,
  status text not null default 'PENDING',
  scan_started boolean not null default false,
  scroll_id text,
  buffer_item_ids jsonb not null default '[]'::jsonb,
  processed_items integer not null default 0,
  products_saved integer not null default 0,
  children_saved integer not null default 0,
  errors_count integer not null default 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercadolibre_sync_jobs_status_check
    check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  constraint mercadolibre_sync_jobs_buffer_array_check
    check (jsonb_typeof(buffer_item_ids) = 'array')
);

create index if not exists idx_ml_sync_jobs_seller_created
  on public.mercadolibre_sync_jobs (seller_id, created_at desc);

alter table public.mercadolibre_sync_jobs enable row level security;
