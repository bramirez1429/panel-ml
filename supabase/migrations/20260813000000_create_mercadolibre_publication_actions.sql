create table if not exists public.mercadolibre_publication_actions (
  id uuid primary key default gen_random_uuid(),
  seller_id bigint not null,
  product_id uuid not null references public.mercadolibre_products(id) on delete cascade,
  item_id text,
  action text not null check (action in (
    'PRICE_UPDATED',
    'STOCK_UPDATED',
    'SKU_UPDATED',
    'PICTURES_UPDATED',
    'PAUSED',
    'ACTIVATED',
    'TITLE_UPDATED',
    'DESCRIPTION_UPDATED',
    'ATTRIBUTES_UPDATED',
    'PROMOTION_APPLIED',
    'PROMOTION_REMOVED',
    'PUBLISHED'
  )),
  status text not null check (status in ('SUCCESS', 'FAILED')),
  old_value jsonb,
  new_value jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists mercadolibre_publication_actions_product_created_idx
  on public.mercadolibre_publication_actions (seller_id, product_id, created_at desc);

create index if not exists mercadolibre_publication_actions_item_created_idx
  on public.mercadolibre_publication_actions (item_id, created_at desc)
  where item_id is not null;

alter table public.mercadolibre_publication_actions enable row level security;
revoke all on table public.mercadolibre_publication_actions from anon, authenticated;
grant select, insert on table public.mercadolibre_publication_actions to service_role;
