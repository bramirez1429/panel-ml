begin;

-- Los vínculos de Tienda Negocio no se mezclan con los de Tiendanube.
-- Un sourceKey representa UNA familia moderna o UNA publicación clásica.
create table if not exists public.tiendanegocio_product_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id),
  store_id text not null,
  source_key text not null,
  product_id bigint,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiendanegocio_link_source_unique unique (user_id, store_id, source_key),
  constraint tiendanegocio_link_status_check check (status in ('PENDING', 'COMPLETED', 'REVIEW_REQUIRED')),
  constraint tiendanegocio_link_product_id_positive check (product_id is null or product_id > 0),
  constraint tiendanegocio_link_completed_check check (status <> 'COMPLETED' or product_id is not null)
);

create index if not exists tiendanegocio_link_store_product_idx
  on public.tiendanegocio_product_links(store_id, product_id)
  where product_id is not null;

-- Estado durable para el barrido, reintentos y avance de la importación masiva.
create table if not exists public.tiendanegocio_migration_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id),
  seller_id bigint not null,
  store_id text not null,
  status text not null default 'DISCOVERING',
  scan_cursor text,
  total_items integer not null default 0,
  processed_items integer not null default 0,
  successful_items integer not null default 0,
  failed_items integer not null default 0,
  current_source_key text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint tiendanegocio_migration_status_check check (
    status in ('DISCOVERING', 'PAUSED', 'QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELED')
  ),
  constraint tiendanegocio_migration_nonnegative_check check (
    total_items >= 0 and processed_items >= 0 and successful_items >= 0 and failed_items >= 0
  )
);

create unique index if not exists tiendanegocio_active_migration_unique
  on public.tiendanegocio_migration_jobs(user_id, store_id)
  where status in ('DISCOVERING', 'PAUSED', 'QUEUED', 'RUNNING');

create table if not exists public.tiendanegocio_migration_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tiendanegocio_migration_jobs(id) on delete cascade,
  source_key text not null,
  title text,
  mla_ids text[] not null default '{}',
  mlau_ids text[] not null default '{}',
  status text not null default 'PENDING',
  product_id bigint,
  attempts integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiendanegocio_migration_item_unique unique (job_id, source_key),
  constraint tiendanegocio_migration_item_status_check check (
    status in ('PENDING', 'PROCESSING', 'RECONCILING', 'SUCCESS', 'FAILED', 'REVIEW_REQUIRED')
  )
);

create index if not exists tiendanegocio_migration_items_pending_idx
  on public.tiendanegocio_migration_items(job_id, status, created_at);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tiendanegocio_product_links',
    'tiendanegocio_migration_jobs'
  ] loop
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.assign_workspace_id_from_user()',
      table_name || '_assign_workspace', table_name
    );
  end loop;
end;
$$;

alter table public.tiendanegocio_product_links enable row level security;
alter table public.tiendanegocio_migration_jobs enable row level security;
alter table public.tiendanegocio_migration_items enable row level security;

revoke all on public.tiendanegocio_product_links,
  public.tiendanegocio_migration_jobs,
  public.tiendanegocio_migration_items
  from public, anon, authenticated;

grant select, insert, update, delete on public.tiendanegocio_product_links,
  public.tiendanegocio_migration_jobs,
  public.tiendanegocio_migration_items
  to service_role;

commit;
