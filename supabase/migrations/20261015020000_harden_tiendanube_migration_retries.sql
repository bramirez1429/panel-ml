begin;

alter table public.tiendanube_migration_jobs
  add column if not exists execution_token uuid not null default gen_random_uuid();

alter table public.tiendanube_migration_items
  add column if not exists retry_cycle integer not null default 0,
  add column if not exists cycle_attempts integer not null default 0;

-- El token forma parte del claim: una reanudación cambia el token y hace que
-- cualquier worker anterior pierda el derecho a recuperar o crear ítems.
create function public.claim_tiendanube_migration_job_v2(
  p_job_id uuid,
  p_execution_token uuid,
  p_now timestamptz,
  p_lease_seconds integer
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_claimed uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_lease_seconds <= 0 then raise exception 'migration_lease_must_be_positive'; end if;

  update public.tiendanube_migration_jobs as migration_job
     set status = case when migration_job.status = 'DISCOVERING'
                       then 'DISCOVERING' else 'RUNNING' end,
         locked_until = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
         updated_at = v_now
   where migration_job.id = p_job_id
     and migration_job.execution_token = p_execution_token
     and (
       migration_job.status in ('DISCOVERING', 'QUEUED', 'WAITING_RECONCILIATION') or
       (migration_job.status = 'RUNNING' and
        (migration_job.locked_until is null or migration_job.locked_until <= v_now))
     )
     and (migration_job.next_run_at is null or migration_job.next_run_at <= v_now)
     and (migration_job.locked_until is null or migration_job.locked_until <= v_now)
  returning migration_job.id into v_claimed;
  if v_claimed is null then return false; end if;

  update public.tiendanube_migration_items as migration_item
     set status = case when migration_item.post_started_at is null then 'PENDING'
                       else 'RECONCILING' end,
         error_code = 'EXECUTION_INTERRUPTED',
         error_message = 'La ejecución anterior se interrumpió y será recuperada.',
         updated_at = v_now
   where migration_item.job_id = p_job_id
     and migration_item.status = 'PROCESSING';
  return true;
end;
$$;

-- Nueva RPC: conserva attempts como historial total y contabiliza los intentos
-- acotados del ciclo actual. La función anterior se mantiene para compatibilidad.
create function public.claim_next_tiendanube_migration_item_v2(
  p_job_id uuid,
  p_execution_token uuid
) returns table (
  id uuid, source_key text, title text, mla_ids text[], family_id text,
  mlau_ids text[], attempts integer, cycle_attempts integer,
  is_reconciliation boolean
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.tiendanube_migration_items%rowtype;
begin
  perform 1
    from public.tiendanube_migration_jobs as migration_job
   where migration_job.id = p_job_id
     and migration_job.execution_token = p_execution_token
     and migration_job.status = 'RUNNING'
  and migration_job.locked_until > pg_catalog.clock_timestamp()
for update of migration_job;
  if not found then return; end if;

  select migration_item.* into v_item
    from public.tiendanube_migration_items as migration_item
   where migration_item.job_id = p_job_id
     and (
       migration_item.status = 'RECONCILING' or
       (migration_item.status = 'PENDING' and migration_item.post_started_at is null)
     )
   order by case when migration_item.status = 'RECONCILING' then 0 else 1 end,
            migration_item.created_at, migration_item.id
   for update skip locked
   limit 1;
  if not found then return; end if;

  update public.tiendanube_migration_items as migration_item
     set status = 'PROCESSING',
         attempts = migration_item.attempts + 1,
         cycle_attempts = migration_item.cycle_attempts + 1,
         updated_at = pg_catalog.clock_timestamp()
   where migration_item.id = v_item.id;

  update public.tiendanube_migration_jobs as migration_job
     set current_source_key = v_item.source_key,
         updated_at = pg_catalog.clock_timestamp()
   where migration_job.id = p_job_id;

  return query
    select v_item.id, v_item.source_key, v_item.title, v_item.mla_ids,
           v_item.family_id, v_item.mlau_ids, v_item.attempts + 1,
           v_item.cycle_attempts + 1,
           v_item.status = 'RECONCILING';
end;
$$;

-- Sólo una reanudación gana. Recupera el item interrumpido sin borrar su
-- historial: antes del POST vuelve a PENDING; después del POST va a reconciliar.
create function public.resume_tiendanube_migration_run(
  p_job_id uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_token uuid;
begin
  update public.tiendanube_migration_jobs as migration_job
     set status = 'QUEUED',
         execution_token = gen_random_uuid(),
         locked_until = null,
         next_run_at = null,
         current_source_key = null,
         error_message = null,
         finished_at = null,
         updated_at = pg_catalog.clock_timestamp()
   where migration_job.id = p_job_id
     and migration_job.status = 'PAUSED'
     and migration_job.locked_until is null
  returning migration_job.execution_token into v_token;

  if v_token is null then return null; end if;

  update public.tiendanube_migration_items as migration_item
     set status = case
                    when migration_item.post_started_at is null then 'PENDING'
                    else 'RECONCILING'
                  end,
         retry_cycle = migration_item.retry_cycle + 1,
         cycle_attempts = 0,
         error_code = 'RESUMED_AFTER_PAUSE',
         error_message = 'Reanudado de forma segura luego de una pausa.',
         updated_at = pg_catalog.clock_timestamp()
   where migration_item.job_id = p_job_id
     and migration_item.status = 'PROCESSING';

  return v_token;
end;
$$;

revoke all on function public.claim_next_tiendanube_migration_item_v2(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.claim_tiendanube_migration_job_v2(uuid,uuid,timestamptz,integer)
  from public, anon, authenticated;
revoke all on function public.resume_tiendanube_migration_run(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_next_tiendanube_migration_item_v2(uuid,uuid)
  to service_role;
grant execute on function public.claim_tiendanube_migration_job_v2(uuid,uuid,timestamptz,integer)
  to service_role;
grant execute on function public.resume_tiendanube_migration_run(uuid)
  to service_role;

commit;
