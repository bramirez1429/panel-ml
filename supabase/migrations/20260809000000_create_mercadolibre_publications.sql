create table if not exists public.mercadolibre_products (
  id uuid primary key default gen_random_uuid(),
  seller_id bigint not null,
  external_key text not null,
  model text not null check (model in ('SHARED', 'VARIANT_PRICING')),
  family_id text,
  parent_item_id text,
  family_name text,
  title text not null,
  thumbnail text,
  status text,
  category_id text,
  currency_id text,
  price_from numeric(14, 2),
  price_to numeric(14, 2),
  stock_total integer not null default 0 check (stock_total >= 0),
  children_count integer not null default 0 check (children_count >= 0),
  permalink text,
  shared_variations jsonb not null default '[]'::jsonb,
  source_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  last_full_sync_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercadolibre_products_seller_external_unique
    unique (seller_id, external_key),
  constraint mercadolibre_products_shared_variations_array_check
    check (jsonb_typeof(shared_variations) = 'array'),
  constraint mercadolibre_products_model_relation_check check (
    (
      model = 'SHARED'
      and parent_item_id is not null
      and family_id is null
    )
    or
    (
      model = 'VARIANT_PRICING'
      and family_id is not null
      and parent_item_id is null
    )
  )
);

create table if not exists public.mercadolibre_product_children (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null
    references public.mercadolibre_products(id) on delete cascade,
  item_id text not null,
  user_product_id text not null,
  variant_label text,
  title text,
  thumbnail text,
  status text,
  currency_id text,
  listing_type_id text,
  price numeric(14, 2),
  available_quantity integer not null default 0
    check (available_quantity >= 0),
  sold_quantity integer not null default 0 check (sold_quantity >= 0),
  attributes jsonb not null default '[]'::jsonb,
  permalink text,
  source_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mercadolibre_children_item_unique unique (item_id),
  constraint mercadolibre_children_attributes_array_check
    check (jsonb_typeof(attributes) = 'array')
);

create index if not exists idx_ml_products_seller_updated
  on public.mercadolibre_products (seller_id, updated_at desc);

create index if not exists idx_ml_products_seller_status
  on public.mercadolibre_products (seller_id, status);

create index if not exists idx_ml_products_family
  on public.mercadolibre_products (family_id)
  where family_id is not null;

create index if not exists idx_ml_products_parent_item
  on public.mercadolibre_products (parent_item_id)
  where parent_item_id is not null;

create index if not exists idx_ml_children_product
  on public.mercadolibre_product_children (product_id);

create index if not exists idx_ml_children_user_product
  on public.mercadolibre_product_children (user_product_id);

create index if not exists idx_ml_children_status
  on public.mercadolibre_product_children (status);

alter table public.mercadolibre_products enable row level security;
alter table public.mercadolibre_product_children enable row level security;

-- Los tokens existentes tambi\u00e9n quedan accesibles solo mediante service role.
alter table if exists public.mercadolibre_tokens enable row level security;
