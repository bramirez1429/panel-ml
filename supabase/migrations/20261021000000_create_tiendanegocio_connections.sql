begin;

create table if not exists public.tiendanegocio_connections (
  user_id uuid primary key references public.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id),
  store_id text not null,
  access_token text not null,
  scope text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiendanegocio_store_nonblank check (char_length(btrim(store_id)) > 0),
  constraint tiendanegocio_token_nonblank check (char_length(btrim(access_token)) > 0)
);

create index if not exists tiendanegocio_connections_workspace_updated_idx
  on public.tiendanegocio_connections (workspace_id, updated_at desc);

drop trigger if exists tiendanegocio_connections_assign_workspace
  on public.tiendanegocio_connections;

create trigger tiendanegocio_connections_assign_workspace
before insert or update on public.tiendanegocio_connections
for each row execute function public.assign_workspace_id_from_user();

alter table public.tiendanegocio_connections enable row level security;
revoke all on public.tiendanegocio_connections from public, anon, authenticated;
grant select, insert, update, delete on public.tiendanegocio_connections to service_role;

commit;
