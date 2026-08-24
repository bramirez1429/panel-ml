begin;

create table if not exists public.tiendanube_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.users(id) on delete cascade,
  store_id text not null,
  access_token text not null,
  token_type text not null,
  scope text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiendanube_connections_user_id_key unique (user_id)
);

alter table public.tiendanube_connections enable row level security;

revoke all on table public.tiendanube_connections
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.tiendanube_connections
  to service_role;

commit;
