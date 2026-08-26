import { ConflictException } from '@nestjs/common';

import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import type { ReplicableProduct } from './tiendanube-replication.types';

export type SourceAttribute = Readonly<{
  id: string;
  name: string;
  value: string;
}>;

export type SourcePicture = Readonly<{
  id: string | null;
  src: string;
}>;

export const TECHNICAL_ATTRIBUTE_IDS = new Set([
  'SELLER_SKU',
  'GTIN',
  'EMPTY_GTIN_REASON',
  'ITEM_CONDITION',
  'MPN',
]);

const COMMERCIAL_ATTRIBUTE_PRIORITY = new Map([
  ['COLOR', 0],
  ['SIZE', 1],
  ['LENGTH', 2],
  ['VOLTAGE', 3],
]);

export function parseItemAttributes(value: unknown): SourceAttribute[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];
    const id = text(entry.id);
    const name = text(entry.name);
    const attributeValue = text(entry.value_name);
    return id && name && attributeValue
      ? [{ id, name, value: attributeValue }]
      : [];
  });
}

export function parseUserProductAttributes(value: unknown): SourceAttribute[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];
    const id = text(entry.id);
    const name = text(entry.name);
    const values = Array.isArray(entry.values) ? entry.values : [];
    const attributeValue = values.flatMap((candidate) => {
      if (!isJsonObject(candidate)) return [];
      const valueName = text(candidate.name);
      return valueName ? [valueName] : [];
    })[0];
    return id && name && attributeValue
      ? [{ id, name, value: attributeValue }]
      : [];
  });
}

export function parsePictures(value: unknown): SourcePicture[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];
    const src = text(entry.secure_url) ?? text(entry.url);
    return src ? [{ id: text(entry.id), src }] : [];
  });
}

export function findSku(value: unknown): string | null {
  return (
    parseItemAttributes(value).find(({ id }) => id === 'SELLER_SKU')?.value ??
    null
  );
}

export function validPrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function validStock(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function requirePrice(value: unknown): number {
  const price = validPrice(value);
  if (price === null)
    throw new ConflictException('Precio de Mercado Libre inválido');
  return price;
}

export function requireStock(value: unknown): number {
  const stock = validStock(value);
  if (stock === null)
    throw new ConflictException('Stock de Mercado Libre inválido');
  return stock;
}

export function requireText(value: unknown, message: string): string {
  const result = text(value);
  if (!result) throw new ConflictException(message);
  return result;
}

export function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

export function chooseVariantAttributes(
  attributesByVariant: readonly (readonly SourceAttribute[])[],
): ReplicableProduct['attributes'] {
  if (attributesByVariant.length < 2) return [];
  const firstOrder = attributesByVariant[0]
    .filter(({ id }) => !TECHNICAL_ATTRIBUTE_IDS.has(id))
    .map(({ id }) => id);
  const ids = [...new Set(firstOrder)].filter((id) => {
    const values = attributesByVariant.map(
      (attributes) =>
        attributes.find((attribute) => attribute.id === id)?.value,
    );
    return values.every(Boolean) && new Set(values).size > 1;
  });
  const candidates = ids.flatMap((id) => {
    const entries = attributesByVariant.flatMap((attributes) =>
      attributes.filter((attribute) => attribute.id === id),
    );
    const names = new Set(entries.map(({ name }) => name.toLocaleLowerCase()));
    return entries.length === attributesByVariant.length && names.size === 1
      ? [{ id, name: entries[0].name }]
      : [];
  });
  if (candidates.length <= 3) {
    ensureUniqueCombinations(attributesByVariant, candidates);
    return candidates;
  }
  const prioritized = [...candidates].sort(
    (left, right) =>
      (COMMERCIAL_ATTRIBUTE_PRIORITY.get(left.id) ?? 100) -
      (COMMERCIAL_ATTRIBUTE_PRIORITY.get(right.id) ?? 100),
  );
  for (let size = 1; size <= 3; size += 1) {
    for (const selection of combinations(prioritized, size)) {
      if (hasUniqueCombinations(attributesByVariant, selection))
        return selection;
    }
  }
  throw new ConflictException(
    'Las variantes requieren más de 3 atributos para distinguirse',
  );
}

export function valuesForAttributes(
  source: readonly SourceAttribute[],
  attributes: ReplicableProduct['attributes'],
): ReplicableProduct['variants'][number]['values'] {
  return attributes.map(({ id }) => {
    const value = source.find((attribute) => attribute.id === id)?.value;
    if (!value)
      throw new ConflictException(
        `La variante no tiene un valor válido para el atributo ${id}`,
      );
    return { attributeId: id, value };
  });
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

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function ensureUniqueCombinations(
  source: readonly (readonly SourceAttribute[])[],
  attributes: ReplicableProduct['attributes'],
): void {
  if (!hasUniqueCombinations(source, attributes))
    throw new ConflictException(
      'No se pueden distinguir las variantes comerciales de Mercado Libre',
    );
}

function hasUniqueCombinations(
  source: readonly (readonly SourceAttribute[])[],
  attributes: ReplicableProduct['attributes'],
): boolean {
  if (attributes.length === 0) return source.length <= 1;
  const keys = source.map((values) =>
    JSON.stringify(
      attributes.map(
        ({ id }) => values.find((attribute) => attribute.id === id)?.value,
      ),
    ),
  );
  return new Set(keys).size === source.length;
}

function combinations<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  const visit = (start: number, selected: T[]): void => {
    if (selected.length === size) {
      result.push(selected);
      return;
    }
    for (let index = start; index < values.length; index += 1) {
      visit(index + 1, [...selected, values[index]]);
    }
  };
  visit(0, []);
  return result;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
