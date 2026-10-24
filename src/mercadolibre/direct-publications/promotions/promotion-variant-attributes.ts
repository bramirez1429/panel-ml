import type { MlAttribute, MlItem } from '../items/items.types';

/**
 * Keep the original Mercado Libre color or pack label (e.g. "Pack 1").
 * Do not infer that a pack label represents a particular physical color.
 * Multi-variation listings have no single variation color/size.
 */
export function promotionVariantAttributesOf(item: MlItem): Readonly<{
  variantColor: string | null;
  variantSize: string | null;
}> {
  const only = onlyVariation(item.variations);
  const attributes = [
    ...(only ? attributesOf(only.attribute_combinations) : []),
    ...(only ? attributesOf(only.attributes) : []),
    ...(item.attributes ?? []),
  ];
  const variantColor = findAttribute(attributes, ['COLOR', 'MAIN_COLOR', 'PRIMARY_COLOR', 'COLOUR'])
    ?? findAttribute(attributes, ['PACK', 'PACK_TYPE', 'COLOR_PACK']);
  const variantSize = findAttribute(attributes, ['SIZE', 'CLOTHING_SIZE', 'TALLE', 'TALLA', 'SIZE_NAME']);
  return { variantColor, variantSize };
}

function findAttribute(attributes: readonly MlAttribute[], names: readonly string[]): string | null {
  for (const attribute of attributes) {
    if (!names.includes(normalize(attribute.id)) && !names.includes(normalize(attribute.name))) continue;
    const value = text(attribute.value_name) ?? text(attribute.values?.[0]?.name);
    if (value) return value;
  }
  return null;
}

function normalize(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/\p{M}+/gu, '').trim().toUpperCase().replace(/[^A-Z0-9]+/gu, '_')
    : '';
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function attributesOf(value: unknown): MlAttribute[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is MlAttribute =>
    typeof entry === 'object' && entry !== null && typeof entry.id === 'string');
}

function onlyVariation(variations: unknown): Record<string, unknown> | null {
  if (!Array.isArray(variations) || variations.length !== 1) return null;
  const value: unknown = variations[0];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
