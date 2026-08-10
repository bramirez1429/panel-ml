import {
  MercadoLibrePublication,
  ReducedAttribute,
  ResolvedVariantPublication,
  SharedVariation,
} from '../publication.types';

const STATUS_PRIORITY = ['active', 'paused', 'closed'] as const;

/** Comprueba que un valor sea un objeto. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Devuelve texto no vacío o null. */
export function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Convierte un identificador externo en texto. */
export function identifierOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

/** Devuelve un número finito o null. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Devuelve una cantidad válida o cero. */
export function quantityOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

/** Normaliza una fecha externa válida. */
export function dateOrNull(value: unknown): string | null {
  const text = textOrNull(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/** Reduce atributos externos a su ID y valor. */
export function reduceAttributes(value: unknown): ReducedAttribute[] {
  if (!Array.isArray(value)) return [];
  const attributes = new Map<string, ReducedAttribute>();

  for (const rawAttribute of value) {
    if (!isObject(rawAttribute)) continue;
    const id = textOrNull(rawAttribute.id);
    if (!id || attributes.has(id)) continue;
    attributes.set(id, {
      id,
      valueName: textOrNull(rawAttribute.value_name),
    });
  }
  return [...attributes.values()];
}

/** Une valores de atributos en una etiqueta genérica. */
export function joinAttributeValues(attributes: ReducedAttribute[]): string {
  return attributes
    .flatMap(({ valueName }) => (valueName ? [valueName] : []))
    .join(' | ');
}

/** Reduce las variaciones que comparten una condición de venta. */
export function reduceSharedVariations(
  value: unknown,
  fallbackTitle: string | null,
): SharedVariation[] {
  if (!Array.isArray(value)) return [];
  const variations = new Map<string, SharedVariation>();

  for (const rawVariation of value) {
    if (!isObject(rawVariation)) continue;
    const id = identifierOrNull(rawVariation.id);
    if (!id) continue;
    const attributes = reduceAttributes(rawVariation.attribute_combinations);
    const label =
      joinAttributeValues(attributes) ||
      fallbackTitle ||
      textOrNull(rawVariation.user_product_id) ||
      id;
    if (variations.has(id)) continue;
    variations.set(id, {
      id,
      label,
      availableQuantity: quantityOrZero(rawVariation.available_quantity),
      soldQuantity: quantityOrZero(rawVariation.sold_quantity),
      attributes,
    });
  }
  return [...variations.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

/** Devuelve el primer texto v\u00e1lido de un campo externo. */
export function firstTextValue(
  publications: MercadoLibrePublication[],
  field: keyof MercadoLibrePublication,
): string | null {
  for (const publication of publications) {
    const value = textOrNull(publication[field]);
    if (value) return value;
  }
  return null;
}

/** Detecta atributos cuyos valores cambian dentro de una familia. */
export function varyingAttributeIds(
  attributesByItem: ReducedAttribute[][],
): string[] {
  const ids = new Set(
    attributesByItem.flatMap((attributes) => attributes.map(({ id }) => id)),
  );

  return [...ids]
    .filter((id) => {
      const values = attributesByItem.map(
        (attributes) =>
          attributes.find((attribute) => attribute.id === id)?.valueName ??
          null,
      );
      return new Set(values).size > 1 && values.some(Boolean);
    })
    .sort();
}

/** Construye la etiqueta de una condición por variante. */
export function buildVariantLabel(
  attributes: ReducedAttribute[],
  varyingIds: string[],
  fallbackTitle: string | null,
  userProductId: string,
): string {
  const relevant = varyingIds.flatMap((id) => {
    const attribute = attributes.find((candidate) => candidate.id === id);
    return attribute ? [attribute] : [];
  });
  return joinAttributeValues(relevant) || fallbackTitle || userProductId;
}

/** Agrega estados con prioridad active, paused y closed. */
export function aggregateStatus(
  publications: MercadoLibrePublication[],
): string | null {
  const statuses = publications.map(({ status }) => textOrNull(status));
  return (
    STATUS_PRIORITY.find((status) => statuses.includes(status)) ??
    statuses.find((status) => status !== null) ??
    null
  );
}

/** Elige un representante estable por status e item ID. */
export function selectRepresentative(
  publications: ResolvedVariantPublication[],
): ResolvedVariantPublication {
  return [...publications].sort((left, right) => {
    const statusDifference =
      statusRank(left.publication.status) -
      statusRank(right.publication.status);
    if (statusDifference !== 0) return statusDifference;
    return publicationId(left).localeCompare(publicationId(right));
  })[0];
}

/** Devuelve la fecha fuente más reciente. */
export function latestSourceDate(
  publications: MercadoLibrePublication[],
): string | null {
  const dates = publications
    .map(({ last_updated }) => dateOrNull(last_updated))
    .filter((value): value is string => value !== null)
    .sort();
  return dates.at(-1) ?? null;
}

/** Calcula el rango de precios conocido. */
export function priceRange(publications: MercadoLibrePublication[]): {
  minimum: number | null;
  maximum: number | null;
} {
  const prices = publications
    .map(({ price }) => numberOrNull(price))
    .filter((price): price is number => price !== null);
  return {
    minimum: prices.length ? Math.min(...prices) : null,
    maximum: prices.length ? Math.max(...prices) : null,
  };
}

/** Ordena un status para elegir el representante. */
function statusRank(value: unknown): number {
  const index = STATUS_PRIORITY.indexOf(
    textOrNull(value) as (typeof STATUS_PRIORITY)[number],
  );
  return index === -1 ? STATUS_PRIORITY.length : index;
}

/** Lee el ID de una publicación resuelta. */
function publicationId(value: ResolvedVariantPublication): string {
  return textOrNull(value.publication.id) ?? '';
}
