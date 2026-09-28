import type { MlItem } from '../items/items.types';

type SkuAttribute = {
  id?: string;
  value_name?: string | null;
};

type SkuSource = Pick<MlItem, 'seller_custom_field'> & {
  attributes?: SkuAttribute[];
};

/** Resuelve el SKU publicado, priorizando el atributo canónico SELLER_SKU. */
export function resolveCanonicalSku(source: Partial<SkuSource>): string | null {
  const sellerSku = source.attributes?.find(
    (attribute) => attribute.id === 'SELLER_SKU',
  )?.value_name;

  if (typeof sellerSku === 'string' && sellerSku.trim()) {
    return sellerSku;
  }

  const fallback = source.seller_custom_field;
  return typeof fallback === 'string' && fallback.trim() ? fallback : null;
}
