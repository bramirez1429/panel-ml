begin;

alter table public.tiendanube_product_links
  alter column ml_product_id drop not null;

alter table public.tiendanube_product_links
  drop constraint if exists tiendanube_product_links_ml_product_id_fkey;

create index if not exists tiendanube_product_links_source_lookup
  on public.tiendanube_product_links (user_id, store_id, ml_source_key);

commit;
