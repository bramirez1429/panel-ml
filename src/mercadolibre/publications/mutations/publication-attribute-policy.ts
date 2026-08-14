import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';
import {
  LiveAttribute,
  parseLiveAttributes,
} from './publication-management.types';
import type { PublicationAttributeUpdate } from './publication-content-input';

export type AllowedAttributeValue = Readonly<{ id: string; name: string }>;

export type CategoryAttributeDefinition = Readonly<{
  id: string;
  name: string;
  required: boolean;
  valueType: string | null;
  allowCustomValue: boolean;
  editable: boolean;
  reason: string | null;
  values: AllowedAttributeValue[];
}>;

export function categoryAttributeDefinitions(
  response: unknown,
  liveItem: Record<string, unknown>,
): CategoryAttributeDefinition[] {
  if (!Array.isArray(response)) {
    throw new BadGatewayException(
      'Mercado Libre devolvio atributos de categoria invalidos',
    );
  }
  const variationIds = variationAttributeIds(liveItem.variations);
  return response.flatMap((candidate) => {
    if (!isJsonObject(candidate) || !isNonEmptyString(candidate.id)) return [];
    const id = candidate.id.trim().toUpperCase();
    const tags = isJsonObject(candidate.tags) ? candidate.tags : {};
    const hierarchy = text(candidate.hierarchy) ?? text(tags.hierarchy);
    const valueType = text(candidate.value_type);
    const reason = blockedReason(id, tags, hierarchy, variationIds);
    return [
      {
        id,
        name: text(candidate.name) ?? id,
        required:
          tags.required === true ||
          tags.new_required === true ||
          tags.catalog_required === true ||
          tags.catalog_listing_required === true,
        valueType,
        allowCustomValue: allowsCustomValue(valueType),
        editable: reason === null,
        reason,
        values: allowedValues(candidate.values),
      },
    ];
  });
}

export function mergeEditableAttributes(
  liveValue: unknown,
  definitions: readonly CategoryAttributeDefinition[],
  updates: readonly PublicationAttributeUpdate[],
): LiveAttribute[] {
  const live = parseLiveAttributes(liveValue ?? []);
  const policies = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const next = live.map((attribute) => ({ ...attribute }));

  for (const update of updates) {
    const policy = policies.get(update.id);
    if (!policy) {
      throw new BadRequestException(
        'El atributo ' + update.id + ' no pertenece a la categoria',
      );
    }
    if (!policy.editable) {
      throw new ConflictException(
        policy.reason ?? 'El atributo ' + update.id + ' no es editable',
      );
    }
    const index = next.findIndex(({ id }) => normalizedId(id) === update.id);
    if (update.clear) {
      if (policy.required) {
        throw new ConflictException(
          'El atributo requerido ' + update.id + ' no se puede eliminar',
        );
      }
      const replacement = {
        id: update.id,
        value_id: null,
        value_name: null,
      };
      if (index < 0) next.push(replacement);
      else next[index] = { ...next[index], ...replacement };
      continue;
    }

    const replacement = replacementAttribute(update, policy);
    if (index < 0) {
      next.push(replacement);
    } else {
      const preserved = { ...next[index] };
      delete preserved.value_id;
      delete preserved.value_name;
      delete preserved.value_struct;
      delete preserved.values;
      next[index] = { ...preserved, ...replacement };
    }
  }
  return next;
}

export function capabilityAttributes(
  liveValue: unknown,
  definitions: readonly CategoryAttributeDefinition[],
) {
  const live = parseLiveAttributes(liveValue ?? []);
  return definitions
    .filter(({ editable }) => editable)
    .map((definition) => {
      const current = live.find(({ id }) => normalizedId(id) === definition.id);
      return {
        id: definition.id,
        name: definition.name,
        valueId: text(current?.value_id),
        value: attributeValueName(current),
        required: definition.required,
        valueType: definition.valueType,
        allowCustomValue: definition.allowCustomValue,
        allowedValues: definition.values,
      };
    });
}

export function auditAttributeValues(value: unknown, ids: readonly string[]) {
  const wanted = new Set(ids);
  return parseLiveAttributes(value ?? [])
    .filter(({ id }) => wanted.has(normalizedId(id)))
    .map((attribute) => ({
      id: normalizedId(attribute.id),
      valueId: text(attribute.value_id),
      valueName: attributeValueName(attribute),
    }));
}

function blockedReason(
  id: string,
  tags: Record<string, unknown>,
  hierarchy: string | null,
  variationIds: ReadonlySet<string>,
): string | null {
  if (id === 'SELLER_SKU')
    return 'El SKU se administra con su control dedicado';
  if (variationIds.has(id)) {
    return 'El atributo pertenece a una variacion y no es comun al item';
  }
  if (tags.allow_variations === true) {
    return 'El atributo se administra como selector de variacion';
  }
  if (
    tags.read_only === true ||
    tags.fixed === true ||
    tags.inferred === true
  ) {
    return 'Mercado Libre marca el atributo como no editable';
  }
  if (tags.hidden === true) return 'Mercado Libre oculta el atributo';
  if (
    hierarchy &&
    ['PARENT_PK', 'CHILD_PK'].includes(hierarchy.toUpperCase())
  ) {
    return 'Las claves de familia no se editan desde el item';
  }
  return null;
}

function replacementAttribute(
  update: PublicationAttributeUpdate,
  policy: CategoryAttributeDefinition,
): LiveAttribute {
  if (update.valueId) {
    const allowed = policy.values.find(({ id }) => id === update.valueId);
    if (policy.values.length > 0 && !allowed) {
      throw new BadRequestException(
        'El valor no esta permitido para ' + update.id,
      );
    }
    return {
      id: update.id,
      value_id: update.valueId,
      ...(allowed ? { value_name: allowed.name } : {}),
    };
  }
  const matching = policy.values.find(
    ({ name }) =>
      name.localeCompare(update.valueName ?? '', 'es', {
        sensitivity: 'accent',
      }) === 0,
  );
  if (policy.values.length > 0 && !policy.allowCustomValue && !matching) {
    throw new BadRequestException(
      'Selecciona un valor permitido para ' + update.id,
    );
  }
  return matching
    ? { id: update.id, value_id: matching.id, value_name: matching.name }
    : { id: update.id, value_name: update.valueName };
}

function allowedValues(value: unknown): AllowedAttributeValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) =>
    isJsonObject(candidate) &&
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.name)
      ? [{ id: candidate.id.trim(), name: candidate.name.trim() }]
      : [],
  );
}

function variationAttributeIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.flatMap((variation) => {
      if (!isJsonObject(variation)) return [];
      return [
        ...attributeIds(variation.attributes),
        ...attributeIds(variation.attribute_combinations),
      ];
    }),
  );
}

function attributeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attribute) =>
    isJsonObject(attribute) && isNonEmptyString(attribute.id)
      ? [attribute.id.trim().toUpperCase()]
      : [],
  );
}

function allowsCustomValue(valueType: string | null): boolean {
  return !valueType || !['list', 'boolean'].includes(valueType.toLowerCase());
}

function attributeValueName(
  attribute: LiveAttribute | undefined,
): string | null {
  const direct = text(attribute?.value_name);
  if (direct) return direct;
  if (!Array.isArray(attribute?.values)) return null;
  return (
    attribute.values
      .flatMap((value) =>
        isJsonObject(value) && isNonEmptyString(value.name)
          ? [value.name.trim()]
          : [],
      )
      .join(', ') || null
  );
}

function normalizedId(value: unknown): string {
  return isNonEmptyString(value) ? value.trim().toUpperCase() : '';
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}
