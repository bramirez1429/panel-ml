begin;

create table public.tiendanube_product_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.users(id) on delete cascade,
  store_id text not null,
  ml_product_id uuid,
  ml_source_key text not null,
  tiendanube_product_id text,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiendanube_product_links_ml_product_id_fkey
    foreign key (ml_product_id)
    references public.mercadolibre_products(id)
    on delete set null,
  constraint tiendanube_product_links_source_key_unique
    unique (user_id, store_id, ml_source_key),
  constraint tiendanube_product_links_store_id_check
    check (
      store_id = btrim(store_id)
      and char_length(store_id) between 1 and 64
    ),
  constraint tiendanube_product_links_source_key_check
    check (
      ml_source_key = btrim(ml_source_key)
      and char_length(ml_source_key) between 1 and 255
    ),
  constraint tiendanube_product_links_status_check
    check (status in ('PENDING', 'FAILED', 'COMPLETED')),
  constraint tiendanube_product_links_completion_check check (
    (
      status = 'COMPLETED'
      and tiendanube_product_id ~ '^[1-9][0-9]*$'
    )
    or
    (
      status in ('PENDING', 'FAILED')
      and tiendanube_product_id is null
    )
  ),
  constraint tiendanube_product_links_timestamps_check
    check (updated_at >= created_at)
);

create index tiendanube_product_links_ml_product_id_idx
  on public.tiendanube_product_links (ml_product_id);

create unique index tiendanube_product_links_tiendanube_product_unique
  on public.tiendanube_product_links (
    user_id,
    store_id,
    tiendanube_product_id
  )
  where tiendanube_product_id is not null;

create index tiendanube_product_links_pending_updated_idx
  on public.tiendanube_product_links (updated_at)
  where status = 'PENDING';

alter table public.tiendanube_product_links enable row level security;

revoke all on table public.tiendanube_product_links
  from public, anon, authenticated, service_role;
grant select on table public.tiendanube_product_links
  to service_role;

create function public.reserve_tiendanube_product_link(
  p_user_id uuid,
  p_store_id text,
  p_ml_product_id uuid,
  p_ml_source_key text
)
returns table (
  outcome text,
  link_id uuid,
  link_status text,
  tiendanube_product_id text,
  reservation_version timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  reserved_link public.tiendanube_product_links%rowtype;
  transition_time timestamptz := pg_catalog.clock_timestamp();
begin
  perform 1
  from public.tiendanube_connections as connection
  where connection.user_id = p_user_id
    and connection.store_id = p_store_id
  for share;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'tiendanube_connection_not_found';
  end if;

  perform 1
  from public.mercadolibre_products as product
  join public.mercadolibre_tokens as token
    on token.seller_id = product.seller_id
  where product.id = p_ml_product_id
    and product.external_key = p_ml_source_key
    and token.user_id = p_user_id
  for key share of product, token;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'mercadolibre_source_not_found';
  end if;

  insert into public.tiendanube_product_links as product_link (
    user_id,
    store_id,
    ml_product_id,
    ml_source_key,
    status,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    p_store_id,
    p_ml_product_id,
    p_ml_source_key,
    'PENDING',
    transition_time,
    transition_time
  )
  on conflict (user_id, store_id, ml_source_key) do nothing
  returning product_link.* into reserved_link;

  if found then
    return query
    select
      'RESERVED'::text,
      reserved_link.id,
      reserved_link.status,
      reserved_link.tiendanube_product_id,
      reserved_link.updated_at;
    return;
  end if;

  select product_link.*
  into reserved_link
  from public.tiendanube_product_links as product_link
  where product_link.user_id = p_user_id
    and product_link.store_id = p_store_id
    and product_link.ml_source_key = p_ml_source_key
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'tiendanube_product_link_disappeared';
  end if;

  if reserved_link.status = 'COMPLETED' then
    return query
    select
      'COMPLETED'::text,
      reserved_link.id,
      reserved_link.status,
      reserved_link.tiendanube_product_id,
      null::timestamptz;
    return;
  end if;

  if reserved_link.status = 'PENDING' then
    return query
    select
      'PENDING'::text,
      reserved_link.id,
      reserved_link.status,
      null::text,
      null::timestamptz;
    return;
  end if;

  transition_time := pg_catalog.clock_timestamp();
  if transition_time <= reserved_link.updated_at then
    transition_time := reserved_link.updated_at + interval '1 microsecond';
  end if;

  update public.tiendanube_product_links as product_link
  set status = 'PENDING',
      ml_product_id = p_ml_product_id,
      tiendanube_product_id = null,
      updated_at = transition_time
  where product_link.id = reserved_link.id
    and product_link.status = 'FAILED'
  returning product_link.* into reserved_link;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'tiendanube_product_link_transition_failed';
  end if;

  return query
  select
    'RESERVED'::text,
    reserved_link.id,
    reserved_link.status,
    null::text,
    reserved_link.updated_at;
end;
$$;

create function public.complete_tiendanube_product_link(
  p_link_id uuid,
  p_user_id uuid,
  p_store_id text,
  p_ml_product_id uuid,
  p_ml_source_key text,
  p_reservation_version timestamptz,
  p_tiendanube_product_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  transition_time timestamptz := pg_catalog.clock_timestamp();
  completion_exists boolean;
begin
  if p_reservation_version is null
    or p_tiendanube_product_id is null
    or p_tiendanube_product_id !~ '^[1-9][0-9]*$'
  then
    return false;
  end if;

  if transition_time <= p_reservation_version then
    transition_time := p_reservation_version + interval '1 microsecond';
  end if;

  update public.tiendanube_product_links as product_link
  set status = 'COMPLETED',
      tiendanube_product_id = p_tiendanube_product_id,
      updated_at = transition_time
  where product_link.id = p_link_id
    and product_link.user_id = p_user_id
    and product_link.store_id = p_store_id
    and (
      product_link.ml_product_id = p_ml_product_id
      or product_link.ml_product_id is null
    )
    and product_link.ml_source_key = p_ml_source_key
    and product_link.status = 'PENDING'
    and product_link.updated_at = p_reservation_version
    and product_link.tiendanube_product_id is null;

  if found then
    return true;
  end if;

  select exists (
    select 1
    from public.tiendanube_product_links as product_link
    where product_link.id = p_link_id
      and product_link.user_id = p_user_id
      and product_link.store_id = p_store_id
      and (
        product_link.ml_product_id = p_ml_product_id
        or product_link.ml_product_id is null
      )
      and product_link.ml_source_key = p_ml_source_key
      and product_link.status = 'COMPLETED'
      and product_link.tiendanube_product_id = p_tiendanube_product_id
  )
  into completion_exists;

  return completion_exists;
end;
$$;

create function public.fail_tiendanube_product_link(
  p_link_id uuid,
  p_user_id uuid,
  p_store_id text,
  p_ml_product_id uuid,
  p_ml_source_key text,
  p_reservation_version timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  transition_time timestamptz := pg_catalog.clock_timestamp();
  failure_exists boolean;
begin
  if p_reservation_version is null then
    return false;
  end if;

  if transition_time <= p_reservation_version then
    transition_time := p_reservation_version + interval '1 microsecond';
  end if;

  update public.tiendanube_product_links as product_link
  set status = 'FAILED',
      updated_at = transition_time
  where product_link.id = p_link_id
    and product_link.user_id = p_user_id
    and product_link.store_id = p_store_id
    and (
      product_link.ml_product_id = p_ml_product_id
      or product_link.ml_product_id is null
    )
    and product_link.ml_source_key = p_ml_source_key
    and product_link.status = 'PENDING'
    and product_link.updated_at = p_reservation_version
    and product_link.tiendanube_product_id is null;

  if found then
    return true;
  end if;

  select exists (
    select 1
    from public.tiendanube_product_links as product_link
    where product_link.id = p_link_id
      and product_link.user_id = p_user_id
      and product_link.store_id = p_store_id
      and (
        product_link.ml_product_id = p_ml_product_id
        or product_link.ml_product_id is null
      )
      and product_link.ml_source_key = p_ml_source_key
      and product_link.status = 'FAILED'
      and product_link.tiendanube_product_id is null
  )
  into failure_exists;

  return failure_exists;
end;
$$;

revoke all on function public.reserve_tiendanube_product_link(
  uuid,
  text,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.reserve_tiendanube_product_link(
  uuid,
  text,
  uuid,
  text
) to service_role;

revoke all on function public.complete_tiendanube_product_link(
  uuid,
  uuid,
  text,
  uuid,
  text,
  timestamptz,
  text
) from public, anon, authenticated;
grant execute on function public.complete_tiendanube_product_link(
  uuid,
  uuid,
  text,
  uuid,
  text,
  timestamptz,
  text
) to service_role;

revoke all on function public.fail_tiendanube_product_link(
  uuid,
  uuid,
  text,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.fail_tiendanube_product_link(
  uuid,
  uuid,
  text,
  uuid,
  text,
  timestamptz
) to service_role;

commit;
