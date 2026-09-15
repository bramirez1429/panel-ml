begin;

create index if not exists tiendanube_connections_store_id_idx
  on public.tiendanube_connections (store_id);

create table public.recent_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  channel text not null check (channel in ('MERCADOLIBRE', 'TIENDANUBE')),
  external_order_id text not null,
  external_order_item_id text not null,
  sold_at timestamptz not null,
  quantity integer not null check (quantity > 0),
  product_name text not null,
  sku text,
  ml_item_id text,
  ml_variation_id text,
  user_product_id text,
  family_id text,
  tn_product_id text,
  tn_variant_id text,
  color text,
  size text,
  mapping_status text not null default 'UNLINKED'
    check (mapping_status in ('LINKED', 'AUTO_LINKED', 'UNLINKED', 'AMBIGUOUS')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel, external_order_id, external_order_item_id)
);

create index recent_sales_user_sold_at_idx
  on public.recent_sales (user_id, sold_at desc);

create table public.variant_channel_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ml_item_id text not null check (ml_item_id ~ '^MLA[0-9]+$'),
  ml_variation_id text,
  user_product_id text,
  family_id text,
  tn_product_id text not null check (tn_product_id ~ '^[1-9][0-9]*$'),
  tn_variant_id text not null check (tn_variant_id ~ '^[1-9][0-9]*$'),
  sku text,
  normalized_color text,
  normalized_size text,
  match_source text not null check (match_source in ('MANUAL', 'SKU', 'ATTRIBUTES')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tn_product_id, tn_variant_id)
);

create unique index variant_channel_links_ml_variant_idx
  on public.variant_channel_links (
    user_id,
    ml_item_id,
    coalesce(ml_variation_id, '')
  );

create index variant_channel_links_family_idx
  on public.variant_channel_links (user_id, family_id);

alter table public.recent_sales enable row level security;
alter table public.variant_channel_links enable row level security;

revoke all on table public.recent_sales from public, anon, authenticated;
revoke all on table public.variant_channel_links from public, anon, authenticated;
grant select, insert, update on table public.recent_sales to service_role;
grant select, insert, update on table public.variant_channel_links to service_role;

commit;
