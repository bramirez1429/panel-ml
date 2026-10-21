begin;
create table if not exists public.tiendanube_bulk_edit_snapshots (
  id uuid primary key, user_id uuid not null references public.users(id) on delete cascade,
  store_id text not null, category_id text not null, changes jsonb not null, variants jsonb not null,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index if not exists tiendanube_bulk_edit_snapshots_owner_idx on public.tiendanube_bulk_edit_snapshots(user_id, store_id, expires_at);
create table if not exists public.tiendanube_bulk_edit_jobs (
  id uuid primary key, user_id uuid not null references public.users(id) on delete cascade,
  store_id text not null, snapshot_id uuid not null references public.tiendanube_bulk_edit_snapshots(id), category_id text not null,
  requested_changes jsonb not null, status text not null default 'QUEUED', total_products integer not null default 0,
  total_variants integer not null default 0, completed_variants integer not null default 0, failed_variants integer not null default 0,
  started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint tiendanube_bulk_edit_jobs_status_check check (status in ('QUEUED','RUNNING','COMPLETED','COMPLETED_WITH_ERRORS','PAUSED'))
);
create table if not exists public.tiendanube_bulk_edit_items (
  id uuid primary key, job_id uuid not null references public.tiendanube_bulk_edit_jobs(id) on delete cascade,
  product_id text not null, product_name text not null, variant_id text not null, sku text, option_values text[] not null default '{}',
  requested_changes jsonb not null, status text not null default 'PENDING', attempts integer not null default 0,
  error_code text, error_message text, updated_at timestamptz not null default now(), unique(job_id, variant_id)
);
create index if not exists tiendanube_bulk_edit_items_job_status_idx on public.tiendanube_bulk_edit_items(job_id, status);
revoke all on public.tiendanube_bulk_edit_snapshots, public.tiendanube_bulk_edit_jobs, public.tiendanube_bulk_edit_items from anon, authenticated;
grant select, insert, update, delete on public.tiendanube_bulk_edit_snapshots, public.tiendanube_bulk_edit_jobs, public.tiendanube_bulk_edit_items to service_role;
commit;
