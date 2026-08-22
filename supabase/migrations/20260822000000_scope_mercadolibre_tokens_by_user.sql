begin;

create table if not exists public.mercadolibre_tokens (
  seller_id bigint primary key,
  nickname text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  user_id uuid
);

alter table public.mercadolibre_tokens
  add column if not exists user_id uuid;

-- No existe una forma segura de inferir el usuario dueño de las conexiones
-- globales anteriores. Se descartan explícitamente en vez de asignarlas.
delete from public.mercadolibre_tokens as connection
where connection.user_id is null
   or not exists (
     select 1
     from public.users as app_user
     where app_user.id = connection.user_id
   );

alter table public.mercadolibre_tokens
  alter column user_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mercadolibre_tokens_user_id_fkey'
      and conrelid = 'public.mercadolibre_tokens'::regclass
  ) then
    alter table public.mercadolibre_tokens
      add constraint mercadolibre_tokens_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade;
  end if;
end;
$$;

create unique index if not exists mercadolibre_tokens_user_id_key
  on public.mercadolibre_tokens (user_id);

alter table public.mercadolibre_tokens enable row level security;

revoke all on table public.mercadolibre_tokens
  from public, anon, authenticated;
grant select, insert, update, delete on table public.mercadolibre_tokens
  to service_role;

create table if not exists public.mercadolibre_oauth_transactions (
  state_hash text primary key,
  user_id uuid not null
    references public.users(id) on delete cascade,
  refresh_session_id uuid not null
    references public.user_refresh_sessions(id) on delete cascade,
  browser_binding_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint mercadolibre_oauth_state_hash_check
    check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint mercadolibre_oauth_browser_binding_hash_check
    check (browser_binding_hash ~ '^[A-Za-z0-9_-]{43}$'),
  constraint mercadolibre_oauth_expiration_check
    check (expires_at > created_at)
);

create index if not exists idx_mercadolibre_oauth_transactions_expiry
  on public.mercadolibre_oauth_transactions (expires_at);

alter table public.mercadolibre_oauth_transactions enable row level security;

revoke all on table public.mercadolibre_oauth_transactions
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.mercadolibre_oauth_transactions
  to service_role;

create or replace function public.create_mercadolibre_oauth_transaction(
  p_state_hash text,
  p_user_id uuid,
  p_refresh_session_id uuid,
  p_browser_binding_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_rows integer;
begin
  delete from public.mercadolibre_oauth_transactions
  where expires_at <= clock_timestamp();

  insert into public.mercadolibre_oauth_transactions (
    state_hash,
    user_id,
    refresh_session_id,
    browser_binding_hash,
    expires_at
  )
  select
    p_state_hash,
    p_user_id,
    p_refresh_session_id,
    p_browser_binding_hash,
    p_expires_at
  where p_expires_at > clock_timestamp()
    and exists (
      select 1
      from public.user_refresh_sessions as session
      where session.id = p_refresh_session_id
        and session.user_id = p_user_id
        and session.revoked_at is null
        and session.expires_at > clock_timestamp()
    )
  on conflict (state_hash) do nothing;

  get diagnostics inserted_rows = row_count;
  return inserted_rows = 1;
end;
$$;

create or replace function public.consume_mercadolibre_oauth_transaction(
  p_state_hash text,
  p_user_id uuid,
  p_browser_binding_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  consumed_rows integer;
begin
  delete from public.mercadolibre_oauth_transactions as oauth_transaction
  where oauth_transaction.state_hash = p_state_hash
    and oauth_transaction.user_id = p_user_id
    and oauth_transaction.browser_binding_hash = p_browser_binding_hash
    and oauth_transaction.expires_at > clock_timestamp()
    and exists (
      select 1
      from public.user_refresh_sessions as session
      where session.id = oauth_transaction.refresh_session_id
        and session.user_id = oauth_transaction.user_id
        and session.revoked_at is null
        and session.expires_at > clock_timestamp()
    );

  get diagnostics consumed_rows = row_count;
  return consumed_rows = 1;
end;
$$;

revoke all on function public.create_mercadolibre_oauth_transaction(
  text,
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.create_mercadolibre_oauth_transaction(
  text,
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;

revoke all on function public.consume_mercadolibre_oauth_transaction(
  text,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.consume_mercadolibre_oauth_transaction(
  text,
  uuid,
  text
) to service_role;

commit;
