begin;

create table if not exists public.tiendanube_migration_jobs (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  seller_id bigint not null,
  store_id text not null,
  status text not null default 'DISCOVERING',
  total_items integer not null default 0,
  processed_items integer not null default 0,
  approved_items integer not null default 0,
  rejected_items integer not null default 0,
  current_source_key text,
  test_limit smallint,
  scan_scroll_id text,
  locked_until timestamptz,
  next_run_at timestamptz,
  error_message varchar(500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint tiendanube_migration_jobs_status_check check (status in (
    'DISCOVERING', 'QUEUED', 'RUNNING', 'WAITING_RECONCILIATION',
    'PAUSED', 'COMPLETED', 'COMPLETED_WITH_REJECTIONS'
  )),
  constraint tiendanube_migration_jobs_counts_check check (
    total_items >= 0 and
    processed_items = approved_items + rejected_items and
    processed_items >= 0 and processed_items <= total_items
  ),
  constraint tiendanube_migration_jobs_test_limit_check
    check (test_limit is null or test_limit in (1, 5, 10))
);

create table if not exists public.tiendanube_migration_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tiendanube_migration_jobs(id) on delete cascade,
  source_key text not null,
  title text,
  mla_ids text[] not null default '{}',
  family_id text,
  mlau_ids text[] not null default '{}',
  status text not null default 'PENDING',
  outcome text,
  tiendanube_product_id text,
  error_code varchar(100),
  error_message varchar(500),
  attempts integer not null default 0,
  post_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiendanube_migration_items_source_key_unique unique (job_id, source_key),
  constraint tiendanube_migration_items_source_key_check check (
    source_key ~ '^(item:MLA[0-9]+|family:[1-9][0-9]*)$'
  ),
  constraint tiendanube_migration_items_status_check check (status in (
    'PENDING', 'PROCESSING', 'RECONCILING', 'APPROVED', 'REJECTED'
  )),
  constraint tiendanube_migration_items_outcome_check check (
    outcome is null or outcome in ('CREATED', 'ALREADY_EXISTS')
  ),
  constraint tiendanube_migration_items_terminal_check check (
    (status = 'APPROVED' and outcome is not null and error_code is null) or
    (status = 'REJECTED' and outcome is null and error_code is not null) or
    status in ('PENDING', 'PROCESSING', 'RECONCILING')
  ),
  constraint tiendanube_migration_items_post_lifecycle_check check (
    (status = 'PENDING' and post_started_at is null) or
    (status = 'RECONCILING' and post_started_at is not null) or
    status in ('PROCESSING', 'APPROVED', 'REJECTED')
  ),
  constraint tiendanube_migration_items_attempts_check check (attempts >= 0)
);

create unique index if not exists tiendanube_migration_one_active_job
  on public.tiendanube_migration_jobs (user_id, seller_id, store_id)
  where status not in ('COMPLETED', 'COMPLETED_WITH_REJECTIONS');
create index if not exists tiendanube_migration_jobs_owner_idx
  on public.tiendanube_migration_jobs (user_id, store_id, created_at desc);
create index if not exists tiendanube_migration_items_status_idx
  on public.tiendanube_migration_items (job_id, status, created_at);

alter table public.tiendanube_migration_jobs enable row level security;
alter table public.tiendanube_migration_items enable row level security;

create or replace function public.create_tiendanube_migration_job(
  p_job_id uuid, p_user_id uuid, p_seller_id bigint, p_store_id text,
  p_test_limit smallint
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.tiendanube_migration_jobs (
    id, user_id, seller_id, store_id, test_limit
  ) values (p_job_id, p_user_id, p_seller_id, p_store_id, p_test_limit)
  on conflict do nothing returning id into v_id;

  if v_id is not null then return v_id; end if;
  select id into v_id from public.tiendanube_migration_jobs
   where user_id = p_user_id and seller_id = p_seller_id and store_id = p_store_id
     and status not in ('COMPLETED', 'COMPLETED_WITH_REJECTIONS')
   order by created_at desc limit 1;
  if v_id is null then raise exception 'could_not_create_tiendanube_migration_job'; end if;
  return v_id;
end;
$$;

create or replace function public.claim_tiendanube_migration_job(
  p_job_id uuid, p_now timestamptz, p_lease_seconds integer
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_claimed uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_lease_seconds <= 0 then raise exception 'migration_lease_must_be_positive'; end if;
  update public.tiendanube_migration_jobs
     set status = case when status = 'DISCOVERING' then 'DISCOVERING' else 'RUNNING' end,
         locked_until = v_now + make_interval(secs => p_lease_seconds),
         updated_at = v_now
   where id = p_job_id
     and (
       status in ('DISCOVERING', 'QUEUED', 'WAITING_RECONCILIATION') or
       (status = 'RUNNING' and (locked_until is null or locked_until <= v_now))
     )
     and (next_run_at is null or next_run_at <= v_now)
     and (locked_until is null or locked_until <= v_now)
  returning id into v_claimed;
  if v_claimed is null then return false; end if;

  update public.tiendanube_migration_items
     set status = case when post_started_at is null then 'PENDING' else 'RECONCILING' end,
         error_code = 'EXECUTION_INTERRUPTED',
         error_message = 'La ejecución anterior se interrumpió y será recuperada.',
         updated_at = v_now
   where job_id = p_job_id and status = 'PROCESSING';
  return true;
end;
$$;

create or replace function public.record_tiendanube_migration_discovery_page(
  p_job_id uuid, p_next_scroll_id text, p_finished boolean, p_items jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_test_limit smallint;
  v_current_count integer;
  v_remaining integer;
begin
  select test_limit into v_test_limit
    from public.tiendanube_migration_jobs
   where id = p_job_id
   for update;
  if not found then raise exception 'migration_job_not_found'; end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'migration_discovery_items_must_be_array';
  end if;

  update public.tiendanube_migration_items as target
     set title = coalesce(nullif(source.title, ''), target.title),
         mla_ids = array(select distinct unnest(target.mla_ids || coalesce(source.mla_ids, '{}'))),
         mlau_ids = array(select distinct unnest(target.mlau_ids || coalesce(source.mlau_ids, '{}'))),
         updated_at = now()
    from jsonb_to_recordset(p_items) as source(
      source_key text, title text, mla_ids text[], family_id text, mlau_ids text[]
    )
   where target.job_id = p_job_id and target.source_key = source.source_key;

  select count(*) into v_current_count
    from public.tiendanube_migration_items where job_id = p_job_id;
  v_remaining := case when v_test_limit is null then 2147483647
                      else greatest(v_test_limit::integer - v_current_count, 0) end;

  insert into public.tiendanube_migration_items (
    job_id, source_key, title, mla_ids, family_id, mlau_ids
  )
  select
    p_job_id,
    source.source_key,
    nullif(source.title, ''),
    coalesce(source.mla_ids, '{}'),
    nullif(source.family_id, ''),
    coalesce(source.mlau_ids, '{}')
  from (
    select distinct on (row.source_key)
      row.source_key, row.title, row.mla_ids, row.family_id, row.mlau_ids
    from jsonb_to_recordset(p_items) as row(
      source_key text, title text, mla_ids text[], family_id text, mlau_ids text[]
    )
    order by row.source_key
  ) as source
  where not exists (
    select 1 from public.tiendanube_migration_items as target
     where target.job_id = p_job_id and target.source_key = source.source_key
  )
  order by source.source_key
  limit v_remaining
  on conflict (job_id, source_key) do nothing;

  update public.tiendanube_migration_jobs
     set scan_scroll_id = p_next_scroll_id,
         total_items = (select count(*) from public.tiendanube_migration_items where job_id = p_job_id),
         status = case when p_finished or (
           test_limit is not null and
           (select count(*) from public.tiendanube_migration_items where job_id = p_job_id) >= test_limit
         ) then 'QUEUED' else 'DISCOVERING' end,
         locked_until = null,
         next_run_at = null,
         updated_at = now()
   where id = p_job_id;
end;
$$;

create or replace function public.claim_next_tiendanube_migration_item(
  p_job_id uuid
) returns table (
  id uuid, source_key text, title text, mla_ids text[], family_id text,
  mlau_ids text[], attempts integer, is_reconciliation boolean
)
language plpgsql security definer set search_path = ''
as $$
declare v_item public.tiendanube_migration_items%rowtype;
begin
  select migration_item.* into v_item
    from public.tiendanube_migration_items as migration_item
   where migration_item.job_id = p_job_id
     and (
       migration_item.status = 'RECONCILING' or
       (migration_item.status = 'PENDING' and migration_item.post_started_at is null)
     )
   order by case when migration_item.status = 'RECONCILING' then 0 else 1 end,
            migration_item.created_at, migration_item.id
   for update skip locked limit 1;
  if not found then return; end if;

  update public.tiendanube_migration_items as migration_item
     set status = 'PROCESSING',
         attempts = migration_item.attempts + 1,
         updated_at = now()
   where migration_item.id = v_item.id;
  update public.tiendanube_migration_jobs as migration_job
     set current_source_key = v_item.source_key, updated_at = now()
   where migration_job.id = p_job_id;
  return query select v_item.id, v_item.source_key, v_item.title, v_item.mla_ids,
    v_item.family_id, v_item.mlau_ids, v_item.attempts + 1,
    v_item.status = 'RECONCILING';
end;
$$;

create or replace function public.mark_tiendanube_migration_post_started(
  p_item_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tiendanube_migration_items
     set post_started_at = now(), updated_at = now()
   where id = p_item_id and status = 'PROCESSING' and post_started_at is null;
  return found;
end;
$$;

create or replace function public.finish_tiendanube_migration_item(
  p_item_id uuid, p_status text, p_outcome text, p_tiendanube_product_id text,
  p_error_code text, p_error_message text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_job_id uuid; v_approved integer; v_rejected integer; v_total integer;
begin
  update public.tiendanube_migration_items
     set status = p_status, outcome = p_outcome,
         tiendanube_product_id = p_tiendanube_product_id,
         error_code = p_error_code, error_message = left(p_error_message, 500),
         updated_at = now()
   where id = p_item_id and status = 'PROCESSING'
  returning job_id into v_job_id;
  if v_job_id is null then raise exception 'migration_item_not_processing'; end if;

  select count(*) filter (where status = 'APPROVED'),
         count(*) filter (where status = 'REJECTED'), count(*)
    into v_approved, v_rejected, v_total
    from public.tiendanube_migration_items where job_id = v_job_id;
  update public.tiendanube_migration_jobs set
    processed_items = v_approved + v_rejected,
    approved_items = v_approved, rejected_items = v_rejected,
    current_source_key = null, locked_until = null,
    status = case when v_approved + v_rejected = v_total
      then case when v_rejected > 0 then 'COMPLETED_WITH_REJECTIONS' else 'COMPLETED' end
      else 'QUEUED' end,
    finished_at = case when v_approved + v_rejected = v_total then now() else null end,
    updated_at = now()
  where id = v_job_id;
end;
$$;

create or replace function public.retry_tiendanube_migration_item(
  p_item_id uuid, p_delay_seconds integer, p_error_code text, p_error_message text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_job_id uuid;
begin
  update public.tiendanube_migration_items
     set status = 'PENDING', error_code = p_error_code,
         error_message = left(p_error_message, 500), updated_at = now()
   where id = p_item_id and status = 'PROCESSING' and post_started_at is null
  returning job_id into v_job_id;
  if v_job_id is null then raise exception 'migration_item_not_processing'; end if;
  update public.tiendanube_migration_jobs set
    status = 'QUEUED', current_source_key = null, locked_until = null,
    next_run_at = now() + make_interval(secs => p_delay_seconds), updated_at = now()
  where id = v_job_id;
end;
$$;

create or replace function public.wait_tiendanube_migration_reconciliation(
  p_item_id uuid, p_delay_seconds integer, p_error_message text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_job_id uuid;
begin
  update public.tiendanube_migration_items
     set status = 'RECONCILING', error_code = 'POST_OUTCOME_UNKNOWN',
         error_message = left(p_error_message, 500), updated_at = now()
   where id = p_item_id and status = 'PROCESSING' and post_started_at is not null
  returning job_id into v_job_id;
  if v_job_id is null then raise exception 'migration_item_not_processing'; end if;
  update public.tiendanube_migration_jobs set
    status = 'WAITING_RECONCILIATION', locked_until = null,
    next_run_at = now() + make_interval(secs => p_delay_seconds), updated_at = now()
  where id = v_job_id;
end;
$$;

create or replace function public.pause_tiendanube_migration_job(
  p_job_id uuid, p_error_message text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tiendanube_migration_jobs set
    status = 'PAUSED', locked_until = null, error_message = left(p_error_message, 500),
    updated_at = now()
  where id = p_job_id;
end;
$$;

create or replace function public.complete_empty_tiendanube_migration_job(
  p_job_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tiendanube_migration_jobs set
    status = 'COMPLETED', processed_items = 0, approved_items = 0,
    rejected_items = 0, current_source_key = null, locked_until = null,
    finished_at = now(), updated_at = now()
  where id = p_job_id and status = 'RUNNING' and total_items = 0;
end;
$$;

create or replace function public.retry_tiendanube_migration_discovery(
  p_job_id uuid, p_delay_seconds integer, p_error_message text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tiendanube_migration_jobs set
    status = 'DISCOVERING', locked_until = null,
    next_run_at = now() + make_interval(secs => p_delay_seconds),
    error_message = left(p_error_message, 500), updated_at = now()
  where id = p_job_id;
end;
$$;

create or replace function public.complete_reconciled_tiendanube_product_link_by_source(
  p_user_id uuid, p_store_id text, p_ml_source_key text, p_tiendanube_product_id text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tiendanube_product_links set
    status = 'COMPLETED', tiendanube_product_id = p_tiendanube_product_id,
    updated_at = now()
  where user_id = p_user_id and store_id = p_store_id
    and ml_source_key = p_ml_source_key and status = 'PENDING'
    and p_tiendanube_product_id ~ '^[1-9][0-9]*$';
  if found then return true; end if;
  return exists (
    select 1 from public.tiendanube_product_links
     where user_id = p_user_id and store_id = p_store_id
       and ml_source_key = p_ml_source_key and status = 'COMPLETED'
       and tiendanube_product_id = p_tiendanube_product_id
  );
end;
$$;

revoke all on function public.create_tiendanube_migration_job(uuid,uuid,bigint,text,smallint) from public, anon, authenticated;
revoke all on function public.claim_tiendanube_migration_job(uuid,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.record_tiendanube_migration_discovery_page(uuid,text,boolean,jsonb) from public, anon, authenticated;
revoke all on function public.claim_next_tiendanube_migration_item(uuid) from public, anon, authenticated;
revoke all on function public.mark_tiendanube_migration_post_started(uuid) from public, anon, authenticated;
revoke all on function public.finish_tiendanube_migration_item(uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.retry_tiendanube_migration_item(uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.wait_tiendanube_migration_reconciliation(uuid,integer,text) from public, anon, authenticated;
revoke all on function public.pause_tiendanube_migration_job(uuid,text) from public, anon, authenticated;
revoke all on function public.complete_empty_tiendanube_migration_job(uuid) from public, anon, authenticated;
revoke all on function public.retry_tiendanube_migration_discovery(uuid,integer,text) from public, anon, authenticated;
revoke all on function public.complete_reconciled_tiendanube_product_link_by_source(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.create_tiendanube_migration_job(uuid,uuid,bigint,text,smallint) to service_role;
grant execute on function public.claim_tiendanube_migration_job(uuid,timestamptz,integer) to service_role;
grant execute on function public.record_tiendanube_migration_discovery_page(uuid,text,boolean,jsonb) to service_role;
grant execute on function public.claim_next_tiendanube_migration_item(uuid) to service_role;
grant execute on function public.mark_tiendanube_migration_post_started(uuid) to service_role;
grant execute on function public.finish_tiendanube_migration_item(uuid,text,text,text,text,text) to service_role;
grant execute on function public.retry_tiendanube_migration_item(uuid,integer,text,text) to service_role;
grant execute on function public.wait_tiendanube_migration_reconciliation(uuid,integer,text) to service_role;
grant execute on function public.pause_tiendanube_migration_job(uuid,text) to service_role;
grant execute on function public.complete_empty_tiendanube_migration_job(uuid) to service_role;
grant execute on function public.retry_tiendanube_migration_discovery(uuid,integer,text) to service_role;
grant execute on function public.complete_reconciled_tiendanube_product_link_by_source(uuid,text,text,text) to service_role;

commit;
