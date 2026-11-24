begin;
-- Aplicar exclusivamente en la base del panel SAEL, antes del despliegue.
alter table public.recent_sales
  add column if not exists order_status text not null default 'paid'
    check (order_status in ('paid','cancelled')),
  add column if not exists buyer_name text,
  add column if not exists unit_price numeric,
  add column if not exists currency text,
  add column if not exists image_url text,
  add column if not exists shipping_status text;

create table public.sales_order_workflow (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('MERCADOLIBRE','TIENDANUBE')),
  external_order_id text not null,
  completed_at timestamptz,
  completed_by uuid references public.users(id) on delete set null,
  primary key (workspace_id,channel,external_order_id)
);

create table public.sales_notification_reads (
  user_id uuid not null references public.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('MERCADOLIBRE','TIENDANUBE')),
  external_order_id text not null,
  read_at timestamptz not null default now(),
  primary key (user_id,workspace_id,channel,external_order_id)
);
alter table public.sales_order_workflow enable row level security;
alter table public.sales_notification_reads enable row level security;
revoke all on public.sales_order_workflow, public.sales_notification_reads from public, anon, authenticated;
grant select,insert,update on public.sales_order_workflow, public.sales_notification_reads to service_role;
create index sales_order_workflow_completed_idx on public.sales_order_workflow(workspace_id,completed_at);
commit;
