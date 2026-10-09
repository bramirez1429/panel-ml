alter table public.mercadolibre_sync_jobs
  add column if not exists total_items integer not null default 0;

alter table public.mercadolibre_sync_jobs
  add constraint mercadolibre_sync_jobs_total_items_check
  check (total_items >= 0);

create unique index if not exists mercadolibre_sync_jobs_one_active_per_seller
  on public.mercadolibre_sync_jobs (seller_id)
  where status in ('PENDING', 'RUNNING');
