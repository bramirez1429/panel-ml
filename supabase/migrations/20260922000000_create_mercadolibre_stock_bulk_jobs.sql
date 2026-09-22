create table if not exists public.mercadolibre_stock_bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  seller_id bigint not null,
  status text not null default 'QUEUED',
  total_items integer not null,
  processed_items integer not null default 0,
  successful_items integer not null default 0,
  failed_items integer not null default 0,
  skipped_items integer not null default 0,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercadolibre_stock_bulk_jobs_status_check
    check (status in (
      'QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'
    )),
  constraint mercadolibre_stock_bulk_jobs_counts_check
    check (
      total_items > 0 and
      processed_items >= 0 and
      successful_items >= 0 and
      failed_items >= 0 and
      skipped_items >= 0 and
      processed_items <= total_items
    )
);

create table if not exists public.mercadolibre_stock_bulk_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.mercadolibre_stock_bulk_jobs(id) on delete cascade,
  position integer not null,
  identifier text not null,
  title text,
  color text,
  size text not null,
  item_id text not null,
  user_product_id text,
  variation_id text,
  family_id text,
  model text not null,
  old_quantity integer not null,
  new_quantity integer not null,
  old_status text,
  store_id text,
  network_node_id text,
  editable boolean not null,
  reason text,
  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  result jsonb,
  error_code varchar(100),
  error_message varchar(500),
  processing_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercadolibre_stock_bulk_job_items_model_check
    check (model in ('USER_PRODUCT', 'LEGACY')),
  constraint mercadolibre_stock_bulk_job_items_status_check
    check (status in ('PENDING', 'PROCESSING', 'SUCCESS', 'ERROR', 'SKIPPED')),
  constraint mercadolibre_stock_bulk_job_items_quantities_check
    check (old_quantity >= 0 and new_quantity >= 0),
  constraint mercadolibre_stock_bulk_job_items_attempts_check
    check (attempt_count >= 0),
  constraint mercadolibre_stock_bulk_job_items_position_unique
    unique (job_id, position),
  constraint mercadolibre_stock_bulk_job_items_identifier_unique
    unique (job_id, identifier)
);

create index if not exists idx_ml_stock_bulk_jobs_owner_created
  on public.mercadolibre_stock_bulk_jobs (user_id, seller_id, created_at desc);

create index if not exists idx_ml_stock_bulk_items_job_position
  on public.mercadolibre_stock_bulk_job_items (job_id, position);

alter table public.mercadolibre_stock_bulk_jobs enable row level security;
alter table public.mercadolibre_stock_bulk_job_items enable row level security;

create or replace function public.create_mercadolibre_stock_bulk_job(
  p_job_id uuid,
  p_user_id uuid,
  p_seller_id bigint,
  p_targets jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception 'stock bulk targets must be a non-empty array';
  end if;

  insert into public.mercadolibre_stock_bulk_jobs (
    id, user_id, seller_id, total_items
  ) values (
    p_job_id, p_user_id, p_seller_id, jsonb_array_length(p_targets)
  );

  insert into public.mercadolibre_stock_bulk_job_items (
    job_id,
    position,
    identifier,
    title,
    color,
    size,
    item_id,
    user_product_id,
    variation_id,
    family_id,
    model,
    old_quantity,
    new_quantity,
    old_status,
    store_id,
    network_node_id,
    editable,
    reason
  )
  select
    p_job_id,
    entry.ordinality::integer - 1,
    entry.value ->> 'identifier',
    nullif(entry.value ->> 'title', ''),
    nullif(entry.value ->> 'color', ''),
    entry.value ->> 'size',
    entry.value ->> 'itemId',
    nullif(entry.value ->> 'userProductId', ''),
    nullif(entry.value ->> 'variationId', ''),
    nullif(entry.value ->> 'familyId', ''),
    entry.value ->> 'model',
    (entry.value ->> 'currentQuantity')::integer,
    (entry.value ->> 'requestedQuantity')::integer,
    nullif(entry.value ->> 'currentStatus', ''),
    nullif(entry.value ->> 'storeId', ''),
    nullif(entry.value ->> 'networkNodeId', ''),
    (entry.value ->> 'editable')::boolean,
    nullif(entry.value ->> 'reason', '')
  from jsonb_array_elements(p_targets) with ordinality as entry(value, ordinality);

  return p_job_id;
end;
$$;

create or replace function public.claim_mercadolibre_stock_bulk_job(
  p_job_id uuid,
  p_stale_before timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  update public.mercadolibre_stock_bulk_jobs
  set
    status = 'RUNNING',
    locked_at = now(),
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = p_job_id
    and (
      status = 'QUEUED' or
      (status = 'RUNNING' and locked_at < p_stale_before)
    )
  returning id into claimed_id;

  if claimed_id is null then
    return false;
  end if;

  update public.mercadolibre_stock_bulk_job_items
  set status = 'PENDING', processing_started_at = null, updated_at = now()
  where job_id = p_job_id and status = 'PROCESSING';

  return true;
end;
$$;

create or replace function public.retry_mercadolibre_stock_bulk_errors(
  p_job_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  retried integer;
begin
  if not exists (
    select 1
    from public.mercadolibre_stock_bulk_jobs
    where id = p_job_id and status = 'COMPLETED_WITH_ERRORS'
  ) then
    return 0;
  end if;

  update public.mercadolibre_stock_bulk_job_items
  set
    status = 'PENDING',
    result = null,
    error_code = null,
    error_message = null,
    processing_started_at = null,
    completed_at = null,
    updated_at = now()
  where job_id = p_job_id and status = 'ERROR';
  get diagnostics retried = row_count;

  if retried > 0 then
    update public.mercadolibre_stock_bulk_jobs
    set
      status = 'QUEUED',
      processed_items = processed_items - retried,
      failed_items = 0,
      locked_at = null,
      completed_at = null,
      error_message = null,
      updated_at = now()
    where id = p_job_id;
  end if;

  return retried;
end;
$$;

revoke all on function public.create_mercadolibre_stock_bulk_job(
  uuid, uuid, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.create_mercadolibre_stock_bulk_job(
  uuid, uuid, bigint, jsonb
) to service_role;

revoke all on function public.claim_mercadolibre_stock_bulk_job(
  uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_mercadolibre_stock_bulk_job(
  uuid, timestamptz
) to service_role;

revoke all on function public.retry_mercadolibre_stock_bulk_errors(uuid)
  from public, anon, authenticated;
grant execute on function public.retry_mercadolibre_stock_bulk_errors(uuid)
  to service_role;
