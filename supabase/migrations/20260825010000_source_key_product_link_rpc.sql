begin;

create or replace function public.reserve_tiendanube_product_link_by_source(
  p_user_id uuid,
  p_store_id text,
  p_ml_source_key text
)
returns table (outcome text, link_id uuid, link_status text, tiendanube_product_id text, reservation_version timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  current_link public.tiendanube_product_links%rowtype;
  transition_time timestamptz := pg_catalog.clock_timestamp();
begin
  if not exists (select 1 from public.tiendanube_connections c where c.user_id = p_user_id and c.store_id = p_store_id) then
    raise exception using errcode = 'P0001', message = 'tiendanube_connection_not_found';
  end if;
  insert into public.tiendanube_product_links (user_id, store_id, ml_product_id, ml_source_key, status, created_at, updated_at)
  values (p_user_id, p_store_id, null, p_ml_source_key, 'PENDING', transition_time, transition_time)
  on conflict (user_id, store_id, ml_source_key) do nothing
  returning * into current_link;
  if found then
    return query select 'RESERVED'::text, current_link.id, current_link.status, null::text, current_link.updated_at;
    return;
  end if;
  select * into current_link from public.tiendanube_product_links l
    where l.user_id = p_user_id and l.store_id = p_store_id and l.ml_source_key = p_ml_source_key for update;
  if current_link.status = 'COMPLETED' then
    return query select 'COMPLETED'::text, current_link.id, current_link.status, current_link.tiendanube_product_id, null::timestamptz;
  elsif current_link.status = 'PENDING' then
    return query select 'PENDING'::text, current_link.id, current_link.status, null::text, null::timestamptz;
  else
    transition_time := pg_catalog.clock_timestamp();
    if transition_time <= current_link.updated_at then transition_time := current_link.updated_at + interval '1 microsecond'; end if;
    update public.tiendanube_product_links l set status = 'PENDING', tiendanube_product_id = null, updated_at = transition_time where l.id = current_link.id returning * into current_link;
    return query select 'RESERVED'::text, current_link.id, current_link.status, null::text, current_link.updated_at;
  end if;
end;
$$;

create or replace function public.complete_tiendanube_product_link_by_source(
  p_link_id uuid, p_user_id uuid, p_store_id text, p_ml_source_key text,
  p_reservation_version timestamptz, p_tiendanube_product_id text
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare changed boolean;
begin
  update public.tiendanube_product_links l set status = 'COMPLETED', tiendanube_product_id = p_tiendanube_product_id, updated_at = pg_catalog.clock_timestamp()
    where l.id = p_link_id and l.user_id = p_user_id and l.store_id = p_store_id and l.ml_source_key = p_ml_source_key and l.status = 'PENDING' and l.updated_at = p_reservation_version and p_tiendanube_product_id ~ '^[1-9][0-9]*$';
  if found then return true; end if;
  select exists(select 1 from public.tiendanube_product_links l where l.id = p_link_id and l.user_id = p_user_id and l.store_id = p_store_id and l.ml_source_key = p_ml_source_key and l.status = 'COMPLETED' and l.tiendanube_product_id = p_tiendanube_product_id) into changed;
  return changed;
end;
$$;

create or replace function public.fail_tiendanube_product_link_by_source(
  p_link_id uuid, p_user_id uuid, p_store_id text, p_ml_source_key text, p_reservation_version timestamptz
)
returns boolean language plpgsql volatile security definer set search_path = ''
as $$
begin
  update public.tiendanube_product_links l set status = 'FAILED', updated_at = pg_catalog.clock_timestamp()
    where l.id = p_link_id and l.user_id = p_user_id and l.store_id = p_store_id and l.ml_source_key = p_ml_source_key and l.status = 'PENDING' and l.updated_at = p_reservation_version and l.tiendanube_product_id is null;
  if found then return true; end if;
  return exists(select 1 from public.tiendanube_product_links l where l.id = p_link_id and l.user_id = p_user_id and l.store_id = p_store_id and l.ml_source_key = p_ml_source_key and l.status = 'FAILED' and l.tiendanube_product_id is null);
end;
$$;

revoke all on function public.reserve_tiendanube_product_link_by_source(uuid,text,text) from public, anon, authenticated;
revoke all on function public.complete_tiendanube_product_link_by_source(uuid,uuid,text,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.fail_tiendanube_product_link_by_source(uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_tiendanube_product_link_by_source(uuid,text,text) to service_role;
grant execute on function public.complete_tiendanube_product_link_by_source(uuid,uuid,text,text,timestamptz,text) to service_role;
grant execute on function public.fail_tiendanube_product_link_by_source(uuid,uuid,text,text,timestamptz) to service_role;

commit;
