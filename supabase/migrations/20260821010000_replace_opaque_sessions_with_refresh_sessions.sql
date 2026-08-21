begin;

lock table public.user_sessions in access exclusive mode;

-- Los tokens opacos anteriores no son refresh tokens validos.
update public.user_sessions
set revoked_at = coalesce(revoked_at, statement_timestamp());

alter table public.user_sessions rename to user_refresh_sessions;
alter table public.user_refresh_sessions
  rename column token_hash to refresh_token_hash;

alter table public.user_refresh_sessions
  rename constraint user_sessions_pkey to user_refresh_sessions_pkey;
alter table public.user_refresh_sessions
  rename constraint user_sessions_user_id_fkey
  to user_refresh_sessions_user_id_fkey;
alter table public.user_refresh_sessions
  rename constraint user_sessions_token_hash_unique
  to user_refresh_sessions_refresh_token_hash_unique;
alter table public.user_refresh_sessions
  rename constraint user_sessions_token_hash_check
  to user_refresh_sessions_refresh_token_hash_check;
alter table public.user_refresh_sessions
  rename constraint user_sessions_expiration_check
  to user_refresh_sessions_expiration_check;

alter index public.idx_user_sessions_user_created
  rename to idx_user_refresh_sessions_user_created;

alter table public.user_refresh_sessions
  add column rotated_at timestamptz;

update public.user_refresh_sessions
set rotated_at = created_at;

alter table public.user_refresh_sessions
  alter column rotated_at set default now(),
  alter column rotated_at set not null;

alter table public.user_refresh_sessions
  add constraint user_refresh_sessions_rotation_check
  check (rotated_at >= created_at and rotated_at <= expires_at);

create function public.create_user_refresh_session(
  p_user_id uuid,
  p_refresh_token_hash text,
  p_ttl_milliseconds bigint
)
returns table (
  id uuid,
  user_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  rotated_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  with session_clock as (
    select statement_timestamp() as current_time
  )
  insert into public.user_refresh_sessions as refresh_session (
    user_id,
    refresh_token_hash,
    expires_at,
    created_at,
    rotated_at
  )
  select
    p_user_id,
    p_refresh_token_hash,
    session_clock.current_time + make_interval(
      secs => p_ttl_milliseconds::double precision / 1000
    ),
    session_clock.current_time,
    session_clock.current_time
  from session_clock
  where p_ttl_milliseconds between 1 and 86400000
  returning
    refresh_session.id,
    refresh_session.user_id,
    refresh_session.expires_at,
    refresh_session.revoked_at,
    refresh_session.created_at,
    refresh_session.rotated_at;
$$;

create function public.rotate_user_refresh_session(
  p_current_refresh_token_hash text,
  p_next_refresh_token_hash text
)
returns table (
  id uuid,
  user_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  rotated_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.user_refresh_sessions as session
  set refresh_token_hash = p_next_refresh_token_hash,
      rotated_at = statement_timestamp()
  where session.refresh_token_hash = p_current_refresh_token_hash
    and session.revoked_at is null
    and session.expires_at > statement_timestamp()
    and p_current_refresh_token_hash <> p_next_refresh_token_hash
  returning
    session.id,
    session.user_id,
    session.expires_at,
    session.revoked_at,
    session.created_at,
    session.rotated_at;
$$;

revoke all
  on function public.create_user_refresh_session(uuid, text, bigint)
  from public;
revoke execute
  on function public.create_user_refresh_session(uuid, text, bigint)
  from anon, authenticated;
grant execute
  on function public.create_user_refresh_session(uuid, text, bigint)
  to service_role;

revoke all
  on function public.rotate_user_refresh_session(text, text)
  from public;
revoke execute
  on function public.rotate_user_refresh_session(text, text)
  from anon, authenticated;
grant execute
  on function public.rotate_user_refresh_session(text, text)
  to service_role;

commit;
