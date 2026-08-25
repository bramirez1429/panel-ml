import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import type { ReplicableProduct } from './tiendanube-replication.types';

export function varyingAttributes(
  items: readonly MercadoLibrePublication[],
): ReplicableProduct['attributes'] {
  const all = new Map<string, { name: string; values: Set<string> }>();
  for (const item of items)
    for (const attribute of parseItemAttributes(item.attributes)) {
      const current = all.get(attribute.id) ?? {
        name: attribute.name,
        values: new Set<string>(),
      };
      current.values.add(attribute.value);
      all.set(attribute.id, current);
    }
  return [...all.entries()]
    .filter(([, value]) => value.values.size > 1)
    .map(([id, value]) => ({ id, name: value.name }));
}

export function valuesFor(
  item: MercadoLibrePublication,
  attributes: readonly ReplicableProduct['attributes'][number][],
) {
  const parsed = parseItemAttributes(item.attributes);
  return attributes.map(({ id }) => ({
    attributeId: id,
    value: parsed.find((value) => value.id === id)?.value ?? '',
  }));
}

function parseItemAttributes(
  value: unknown,
): Array<{ id: string; name: string; value: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as {
      id?: unknown;
      name?: unknown;
      value_name?: unknown;
    };
    return typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      typeof candidate.value_name === 'string' &&
      candidate.value_name.trim()
      ? [
          {
            id: candidate.id,
            name: candidate.name,
            value: candidate.value_name.trim(),
          },
        ]
      : [];
  });
}

export function sku(value: unknown): string | null {
  return (
    parseItemAttributes(value).find(
      (attribute) => attribute.id === 'SELLER_SKU',
    )?.value ?? null
  );
}

export function collectSkus(product: ReplicableProduct): string[] {
  return [
    ...new Set(
      product.variants.flatMap((value) =>
        value.sku?.trim() ? [value.sku.trim()] : [],
      ),
    ),
  ];
}

export function metadata(
  item: MercadoLibrePublication,
): Pick<ReplicableProduct, 'brand' | 'tags'> {
  return {
    brand: null,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((value): value is string => typeof value === 'string')
      : [],
  };
}
