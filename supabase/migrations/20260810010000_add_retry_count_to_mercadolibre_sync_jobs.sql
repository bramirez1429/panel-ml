alter table public.mercadolibre_sync_jobs
  add column if not exists retry_count integer not null default 0;
