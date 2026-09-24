begin;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_slug_not_blank_check
    check (char_length(btrim(slug)) > 0),
  constraint workspaces_name_not_blank_check
    check (char_length(btrim(name)) > 0)
);

create table if not exists public.workspace_members (
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  constraint workspace_members_pkey primary key (workspace_id, user_id),
  constraint workspace_members_role_check check (role in ('OWNER', 'MEMBER'))
);

create unique index if not exists workspace_members_user_id_key
  on public.workspace_members (user_id);

insert into public.workspaces (slug, name)
values ('sael', 'SAEL')
on conflict (slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
select workspace.id, app_user.id, 'MEMBER'
from public.workspaces as workspace
cross join public.users as app_user
where workspace.slug = 'sael'
on conflict (user_id) do nothing;

alter table public.mercadolibre_tokens
  add column if not exists workspace_id uuid;

alter table public.tiendanube_connections
  add column if not exists workspace_id uuid;

alter table public.tiendanube_product_links
  add column if not exists workspace_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mercadolibre_tokens_workspace_id_fkey'
      and conrelid = 'public.mercadolibre_tokens'::regclass
  ) then
    alter table public.mercadolibre_tokens
      add constraint mercadolibre_tokens_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tiendanube_connections_workspace_id_fkey'
      and conrelid = 'public.tiendanube_connections'::regclass
  ) then
    alter table public.tiendanube_connections
      add constraint tiendanube_connections_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tiendanube_product_links_workspace_id_fkey'
      and conrelid = 'public.tiendanube_product_links'::regclass
  ) then
    alter table public.tiendanube_product_links
      add constraint tiendanube_product_links_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id);
  end if;
end;
$$;

update public.mercadolibre_tokens as connection
set workspace_id = member.workspace_id
from public.workspace_members as member
where member.user_id = connection.user_id
  and connection.workspace_id is null;

update public.tiendanube_connections as connection
set workspace_id = member.workspace_id
from public.workspace_members as member
where member.user_id = connection.user_id
  and connection.workspace_id is null;

update public.tiendanube_product_links as product_link
set workspace_id = member.workspace_id
from public.workspace_members as member
where member.user_id = product_link.user_id
  and product_link.workspace_id is null;

do $$
begin
  if exists (
    select 1
    from public.mercadolibre_tokens as connection
    join public.users as app_user on app_user.id = connection.user_id
    where connection.workspace_id is null
  ) then
    raise exception 'mercadolibre_tokens_workspace_backfill_failed';
  end if;

  if exists (
    select 1
    from public.tiendanube_connections as connection
    join public.users as app_user on app_user.id = connection.user_id
    where connection.workspace_id is null
  ) then
    raise exception 'tiendanube_connections_workspace_backfill_failed';
  end if;

  if exists (
    select 1
    from public.tiendanube_product_links as product_link
    join public.users as app_user on app_user.id = product_link.user_id
    where product_link.workspace_id is null
  ) then
    raise exception 'tiendanube_product_links_workspace_backfill_failed';
  end if;
end;
$$;

create index if not exists mercadolibre_tokens_workspace_id_idx
  on public.mercadolibre_tokens (workspace_id);

create index if not exists tiendanube_connections_workspace_updated_idx
  on public.tiendanube_connections (workspace_id, updated_at desc);

create index if not exists tiendanube_product_links_workspace_id_idx
  on public.tiendanube_product_links (workspace_id);

create or replace function public.assign_workspace_id_from_user()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  resolved_workspace_id uuid;
begin
  select member.workspace_id
  into resolved_workspace_id
  from public.workspace_members as member
  where member.user_id = new.user_id;

  if resolved_workspace_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'workspace_membership_not_found';
  end if;

  if new.workspace_id is null then
    new.workspace_id := resolved_workspace_id;
  elsif new.workspace_id <> resolved_workspace_id then
    raise exception using
      errcode = 'P0001',
      message = 'workspace_membership_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists mercadolibre_tokens_assign_workspace
  on public.mercadolibre_tokens;
create trigger mercadolibre_tokens_assign_workspace
before insert or update on public.mercadolibre_tokens
for each row execute function public.assign_workspace_id_from_user();

drop trigger if exists tiendanube_connections_assign_workspace
  on public.tiendanube_connections;
create trigger tiendanube_connections_assign_workspace
before insert or update on public.tiendanube_connections
for each row execute function public.assign_workspace_id_from_user();

drop trigger if exists tiendanube_product_links_assign_workspace
  on public.tiendanube_product_links;
create trigger tiendanube_product_links_assign_workspace
before insert or update on public.tiendanube_product_links
for each row execute function public.assign_workspace_id_from_user();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

revoke all on table public.workspaces, public.workspace_members
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.workspaces, public.workspace_members
  to service_role;

commit;
