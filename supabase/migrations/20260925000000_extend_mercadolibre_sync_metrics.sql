begin;

alter table public.mercadolibre_products
  add column if not exists sold_total integer not null default 0;

alter table public.mercadolibre_products
  drop constraint if exists mercadolibre_products_sold_total_check;
alter table public.mercadolibre_products
  add constraint mercadolibre_products_sold_total_check
  check (sold_total >= 0);

alter table public.mercadolibre_sync_jobs
  add column if not exists total_items integer not null default 0,
  add column if not exists successful_items integer not null default 0,
  add column if not exists failed_items integer not null default 0;

update public.mercadolibre_sync_jobs
set
  failed_items = least(processed_items, errors_count),
  successful_items = greatest(processed_items - errors_count, 0),
  total_items = greatest(total_items, processed_items);

alter table public.mercadolibre_sync_jobs
  drop constraint if exists mercadolibre_sync_jobs_status_check;
alter table public.mercadolibre_sync_jobs
  add constraint mercadolibre_sync_jobs_status_check
  check (status in (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'COMPLETED_WITH_ERRORS',
    'FAILED'
  ));

alter table public.mercadolibre_sync_jobs
  drop constraint if exists mercadolibre_sync_jobs_progress_check;
alter table public.mercadolibre_sync_jobs
  add constraint mercadolibre_sync_jobs_progress_check check (
    total_items >= 0
    and processed_items >= 0
    and successful_items >= 0
    and failed_items >= 0
    and processed_items = successful_items + failed_items
  );

with ranked_active_jobs as (
  select
    id,
    row_number() over (
      partition by seller_id
      order by created_at desc, id desc
    ) as active_order
  from public.mercadolibre_sync_jobs
  where status in ('PENDING', 'RUNNING')
)
update public.mercadolibre_sync_jobs as jobs
set
  status = 'FAILED',
  last_error = 'Trabajo activo reemplazado al aplicar la protección de concurrencia',
  finished_at = coalesce(jobs.finished_at, now()),
  updated_at = now()
from ranked_active_jobs
where jobs.id = ranked_active_jobs.id
  and ranked_active_jobs.active_order > 1;

create unique index if not exists mercadolibre_sync_jobs_one_active_per_seller
  on public.mercadolibre_sync_jobs (seller_id)
  where status in ('PENDING', 'RUNNING');

create index if not exists mercadolibre_sync_jobs_seller_finished_idx
  on public.mercadolibre_sync_jobs (seller_id, finished_at desc);

commit;
