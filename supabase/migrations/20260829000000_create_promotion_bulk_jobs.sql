create table if not exists public.mercadolibre_promotion_bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  seller_id bigint not null,
  status text not null default 'QUEUED',
  total_items integer not null,
  processed_items integer not null default 0,
  successful_items integer not null default 0,
  failed_items integer not null default 0,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercadolibre_promotion_bulk_jobs_status_check
    check (status in ('QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS')),
  constraint mercadolibre_promotion_bulk_jobs_counts_check
    check (
      total_items > 0 and processed_items >= 0 and successful_items >= 0 and
      failed_items >= 0 and processed_items <= total_items
    )
);

create table if not exists public.mercadolibre_promotion_bulk_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.mercadolibre_promotion_bulk_jobs(id) on delete cascade,
  position integer not null,
  item_id text not null,
  request jsonb not null,
  status text not null default 'QUEUED',
  error_code text,
  provider_message varchar(500),
  processing_started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercadolibre_promotion_bulk_job_items_status_check
    check (status in ('QUEUED', 'PROCESSING', 'SCHEDULED', 'ACTIVE', 'ERROR')),
  constraint mercadolibre_promotion_bulk_job_items_position_unique
    unique (job_id, position)
);

create index if not exists idx_ml_promotion_bulk_jobs_owner_created
  on public.mercadolibre_promotion_bulk_jobs (user_id, seller_id, created_at desc);

create index if not exists idx_ml_promotion_bulk_items_job_position
  on public.mercadolibre_promotion_bulk_job_items (job_id, position);

alter table public.mercadolibre_promotion_bulk_jobs enable row level security;
alter table public.mercadolibre_promotion_bulk_job_items enable row level security;

create or replace function public.create_mercadolibre_promotion_bulk_job(
  p_job_id uuid,
  p_user_id uuid,
  p_seller_id bigint,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'promotion bulk items must be a non-empty array';
  end if;

  insert into public.mercadolibre_promotion_bulk_jobs (
    id, user_id, seller_id, total_items
  ) values (
    p_job_id, p_user_id, p_seller_id, jsonb_array_length(p_items)
  );

  insert into public.mercadolibre_promotion_bulk_job_items (
    job_id, position, item_id, request
  )
  select
    p_job_id,
    entry.ordinality::integer - 1,
    entry.value ->> 'itemId',
    entry.value -> 'request'
  from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality);

  return p_job_id;
end;
$$;

create or replace function public.claim_mercadolibre_promotion_bulk_job(
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
  update public.mercadolibre_promotion_bulk_jobs
  set
    status = 'PROCESSING',
    locked_at = now(),
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = p_job_id
    and (
      status = 'QUEUED' or
      (status = 'PROCESSING' and locked_at < p_stale_before)
    )
  returning id into claimed_id;

  if claimed_id is null then
    return false;
  end if;

  update public.mercadolibre_promotion_bulk_job_items
  set status = 'QUEUED', processing_started_at = null, updated_at = now()
  where job_id = p_job_id and status = 'PROCESSING';

  return true;
end;
$$;

revoke all on function public.create_mercadolibre_promotion_bulk_job(
  uuid, uuid, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.create_mercadolibre_promotion_bulk_job(
  uuid, uuid, bigint, jsonb
) to service_role;

revoke all on function public.claim_mercadolibre_promotion_bulk_job(
  uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_mercadolibre_promotion_bulk_job(
  uuid, timestamptz
) to service_role;
