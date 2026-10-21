begin;
alter table public.tiendanube_bulk_edit_jobs add column if not exists execution_token uuid not null default gen_random_uuid(), add column if not exists lease_expires_at timestamptz, add column if not exists error_message text;
alter table public.tiendanube_bulk_edit_items add column if not exists processing_started_at timestamptz;

create or replace function public.create_tiendanube_bulk_edit_job(p_job_id uuid,p_execution_token uuid,p_snapshot_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s public.tiendanube_bulk_edit_snapshots%rowtype;
begin select * into s from tiendanube_bulk_edit_snapshots where id=p_snapshot_id and expires_at>now() for share; if not found then raise exception 'snapshot expired or missing'; end if;
insert into tiendanube_bulk_edit_jobs(id,user_id,store_id,snapshot_id,category_id,requested_changes,total_products,total_variants,status,execution_token)
values(p_job_id,s.user_id,s.store_id,s.id,s.category_id,s.changes,(select count(distinct x->>'productId') from jsonb_array_elements(s.variants) x),jsonb_array_length(s.variants),'QUEUED',p_execution_token);
insert into tiendanube_bulk_edit_items(id,job_id,product_id,product_name,variant_id,sku,option_values,requested_changes,status)
select gen_random_uuid(),p_job_id,x->>'productId',x->>'productName',x->>'variantId',nullif(x->>'sku',''),coalesce(array(select jsonb_array_elements_text(x->'optionValues')),'{}'),s.changes,'PENDING' from jsonb_array_elements(s.variants) x;
return p_job_id; end $$;

create or replace function public.claim_tiendanube_bulk_edit_job(p_job_id uuid,p_execution_token uuid,p_now timestamptz,p_lease_seconds integer) returns boolean language plpgsql security definer set search_path=public as $$
begin
update tiendanube_bulk_edit_jobs set status='RUNNING',started_at=coalesce(started_at,p_now),lease_expires_at=p_now+make_interval(secs=>p_lease_seconds),updated_at=p_now
where id=p_job_id and execution_token=p_execution_token and status in ('QUEUED','RUNNING') and (lease_expires_at is null or lease_expires_at<p_now);
return found; end $$;

create or replace function public.claim_tiendanube_bulk_edit_items(p_job_id uuid,p_execution_token uuid,p_limit integer) returns setof tiendanube_bulk_edit_items language plpgsql security definer set search_path=public as $$
begin
if not exists(select 1 from tiendanube_bulk_edit_jobs where id=p_job_id and execution_token=p_execution_token and status='RUNNING' and lease_expires_at>=now()) then return; end if;
update tiendanube_bulk_edit_items set status='PENDING',processing_started_at=null,updated_at=now() where job_id=p_job_id and status='PROCESSING' and processing_started_at<now()-interval '2 minutes';
return query with picked as (select id from tiendanube_bulk_edit_items where job_id=p_job_id and status='PENDING' order by updated_at,id limit greatest(1,least(p_limit,50)) for update skip locked)
update tiendanube_bulk_edit_items i set status='PROCESSING',attempts=i.attempts+1,processing_started_at=now(),updated_at=now() from picked where i.id=picked.id returning i.*; end $$;

create or replace function public.finish_tiendanube_bulk_edit_items(p_job_id uuid,p_execution_token uuid,p_success_item_ids uuid[],p_failures jsonb) returns boolean language plpgsql security definer set search_path=public as $$
begin
if not exists(select 1 from tiendanube_bulk_edit_jobs where id=p_job_id and execution_token=p_execution_token and status='RUNNING' and lease_expires_at>=now()) then return false; end if;
update tiendanube_bulk_edit_items set status='SUCCESS',error_code=null,error_message=null,processing_started_at=null,updated_at=now() where job_id=p_job_id and id=any(p_success_item_ids) and status='PROCESSING';
update tiendanube_bulk_edit_items i set status='ERROR',error_code=left(x->>'code',100),error_message=left(x->>'message',500),processing_started_at=null,updated_at=now() from jsonb_array_elements(p_failures) x where i.job_id=p_job_id and i.id=(x->>'id')::uuid and i.status='PROCESSING'; return true; end $$;

create or replace function public.retry_tiendanube_bulk_edit_items(p_job_id uuid,p_execution_token uuid,p_item_ids uuid[],p_error_message text) returns boolean language plpgsql security definer set search_path=public as $$
begin if not exists(select 1 from tiendanube_bulk_edit_jobs where id=p_job_id and execution_token=p_execution_token and status='RUNNING' and lease_expires_at>=now()) then return false; end if;
update tiendanube_bulk_edit_items set status=case when attempts>=3 then 'ERROR' else 'PENDING' end,error_code=case when attempts>=3 then 'GENERAL_API_RETRIES_EXHAUSTED' else 'GENERAL_API_RETRY' end,error_message=left(p_error_message,500),processing_started_at=null,updated_at=now() where job_id=p_job_id and id=any(p_item_ids) and status='PROCESSING'; update tiendanube_bulk_edit_jobs set status='QUEUED',lease_expires_at=null,updated_at=now() where id=p_job_id and execution_token=p_execution_token; return true; end $$;

create or replace function public.refresh_tiendanube_bulk_edit_job(p_job_id uuid,p_execution_token uuid) returns public.tiendanube_bulk_edit_jobs language plpgsql security definer set search_path=public as $$
declare total integer; ok integer; bad integer; result public.tiendanube_bulk_edit_jobs%rowtype;
begin if not exists(select 1 from tiendanube_bulk_edit_jobs where id=p_job_id and execution_token=p_execution_token and status='RUNNING') then raise exception 'stale worker'; end if;
select count(*),count(*) filter(where status='SUCCESS'),count(*) filter(where status='ERROR') into total,ok,bad from tiendanube_bulk_edit_items where job_id=p_job_id;
update tiendanube_bulk_edit_jobs set completed_variants=ok,failed_variants=bad,status=case when ok+bad=total then case when bad>0 then 'COMPLETED_WITH_ERRORS' else 'COMPLETED' end else 'QUEUED' end,finished_at=case when ok+bad=total then now() else null end,lease_expires_at=null,updated_at=now() where id=p_job_id and execution_token=p_execution_token returning * into result; return result; end $$;

create or replace function public.retry_tiendanube_bulk_edit_failures(p_job_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; token uuid:=gen_random_uuid(); begin
if not exists(select 1 from tiendanube_bulk_edit_jobs where id=p_job_id and status='COMPLETED_WITH_ERRORS') then raise exception 'job is not retryable'; end if;
update tiendanube_bulk_edit_items set status='PENDING',error_code=null,error_message=null,processing_started_at=null,updated_at=now() where job_id=p_job_id and status='ERROR' and attempts<3; get diagnostics n=row_count;
if n>0 then update tiendanube_bulk_edit_jobs set status='QUEUED',failed_variants=0,execution_token=token,lease_expires_at=null,finished_at=null,updated_at=now() where id=p_job_id; end if;
return jsonb_build_object('count',n,'executionToken',case when n>0 then token::text else null end); end $$;

revoke all on function public.create_tiendanube_bulk_edit_job(uuid,uuid,uuid),public.claim_tiendanube_bulk_edit_job(uuid,uuid,timestamptz,integer),public.claim_tiendanube_bulk_edit_items(uuid,uuid,integer),public.finish_tiendanube_bulk_edit_items(uuid,uuid,uuid[],jsonb),public.retry_tiendanube_bulk_edit_items(uuid,uuid,uuid[],text),public.refresh_tiendanube_bulk_edit_job(uuid,uuid),public.retry_tiendanube_bulk_edit_failures(uuid) from public,anon,authenticated;
grant execute on function public.create_tiendanube_bulk_edit_job(uuid,uuid,uuid),public.claim_tiendanube_bulk_edit_job(uuid,uuid,timestamptz,integer),public.claim_tiendanube_bulk_edit_items(uuid,uuid,integer),public.finish_tiendanube_bulk_edit_items(uuid,uuid,uuid[],jsonb),public.retry_tiendanube_bulk_edit_items(uuid,uuid,uuid[],text),public.refresh_tiendanube_bulk_edit_job(uuid,uuid),public.retry_tiendanube_bulk_edit_failures(uuid) to service_role;
commit;
