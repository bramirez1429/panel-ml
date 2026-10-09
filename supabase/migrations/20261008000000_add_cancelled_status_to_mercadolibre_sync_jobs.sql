alter table public.mercadolibre_sync_jobs
  drop constraint if exists mercadolibre_sync_jobs_status_check;

alter table public.mercadolibre_sync_jobs
  add constraint mercadolibre_sync_jobs_status_check
  check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'));
