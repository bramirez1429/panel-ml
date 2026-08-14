alter table public.mercadolibre_products
  add column if not exists pictures jsonb not null default '[]'::jsonb,
  add column if not exists shared_skus jsonb not null default '{}'::jsonb,
  add column if not exists management_synced_at timestamptz;

alter table public.mercadolibre_product_children
  add column if not exists pictures jsonb not null default '[]'::jsonb,
  add column if not exists management_synced_at timestamptz;

alter table public.mercadolibre_products
  add constraint mercadolibre_products_pictures_array_check
    check (jsonb_typeof(pictures) = 'array'),
  add constraint mercadolibre_products_shared_skus_object_check
    check (jsonb_typeof(shared_skus) = 'object');

alter table public.mercadolibre_product_children
  add constraint mercadolibre_children_pictures_array_check
    check (jsonb_typeof(pictures) = 'array');
