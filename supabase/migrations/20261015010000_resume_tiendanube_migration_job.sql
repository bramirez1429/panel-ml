begin;

create or replace function public.claim_next_tiendanube_migration_item(
  p_job_id uuid
) returns table (
  id uuid, source_key text, title text, mla_ids text[], family_id text,
  mlau_ids text[], attempts integer, is_reconciliation boolean
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.tiendanube_migration_items%rowtype;
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
   for update skip locked
   limit 1;
  if not found then return; end if;

  update public.tiendanube_migration_items as migration_item
     set status = 'PROCESSING',
         attempts = migration_item.attempts + 1,
         updated_at = pg_catalog.clock_timestamp()
   where migration_item.id = v_item.id;

  update public.tiendanube_migration_jobs as migration_job
     set current_source_key = v_item.source_key,
         updated_at = pg_catalog.clock_timestamp()
   where migration_job.id = p_job_id;

  return query
    select v_item.id, v_item.source_key, v_item.title, v_item.mla_ids,
           v_item.family_id, v_item.mlau_ids, v_item.attempts + 1,
           v_item.status = 'RECONCILING';
end;
$$;

create or replace function public.resume_tiendanube_migration_job(
  p_job_id uuid
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_resumed uuid;
begin
  update public.tiendanube_migration_jobs as migration_job
     set status = 'QUEUED',
         locked_until = null,
         next_run_at = null,
         current_source_key = null,
         error_message = null,
         finished_at = null,
         updated_at = pg_catalog.clock_timestamp()
   where migration_job.id = p_job_id
     and migration_job.status = 'PAUSED'
     and migration_job.locked_until is null
  returning migration_job.id into v_resumed;
  return v_resumed is not null;
end;
$$;

revoke all on function public.claim_next_tiendanube_migration_item(uuid)
  from public, anon, authenticated;
revoke all on function public.resume_tiendanube_migration_job(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_next_tiendanube_migration_item(uuid)
  to service_role;
grant execute on function public.resume_tiendanube_migration_job(uuid)
  to service_role;

commit;
