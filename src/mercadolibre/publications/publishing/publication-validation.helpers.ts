import { BadRequestException } from '@nestjs/common';
import { isJsonObject } from '../../shared/mercadolibre.types';

export type ValidationIssue = {
  code: string | null;
  field: string | null;
  message: string;
  itemIndex: number;
};

export function conditionalAttributesPath(
  payload: Record<string, unknown>,
): string {
  const categoryId = payload.category_id;
  if (typeof categoryId !== 'string' || !/^MLA\d+$/.test(categoryId)) {
    throw new BadRequestException('category_id es invalido');
  }
  return `/categories/${encodeURIComponent(categoryId)}/attributes/conditional`;
}

export function conditionalAttributeIssues(
  value: unknown,
  payload: Record<string, unknown>,
  itemIndex: number,
): ValidationIssue[] {
  if (!isJsonObject(value) || !Array.isArray(value.required_attributes)) {
    return [];
  }
  const present = attributeIds(payload);
  return value.required_attributes.flatMap((attribute) => {
    if (!isJsonObject(attribute) || typeof attribute.id !== 'string') return [];
    if (present.has(attribute.id)) return [];
    return [
      {
        code: 'item.attribute.missing_conditional_required',
        field: attribute.id,
        message: `El atributo ${text(attribute.name) ?? attribute.id} es obligatorio para esta publicacion`,
        itemIndex,
      },
    ];
  });
}

export function validationIssues(
  value: unknown,
  itemIndex: number,
): ValidationIssue[] {
  if (isJsonObject(value) && Array.isArray(value.cause) && value.cause.length) {
    return value.cause.map((cause) => issue(cause, value, itemIndex));
  }
  return [issue(value, value, itemIndex)];
}

function attributeIds(payload: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  addAttributeIds(payload.attributes, ids);
  if (Array.isArray(payload.variations)) {
    for (const variation of payload.variations) {
      if (!isJsonObject(variation)) continue;
      addAttributeIds(variation.attributes, ids);
      addAttributeIds(variation.attribute_combinations, ids);
    }
  }
  return ids;
}

function addAttributeIds(value: unknown, ids: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const attribute of value) {
    if (isJsonObject(attribute) && typeof attribute.id === 'string') {
      ids.add(attribute.id);
    }
  }
}

function issue(
  value: unknown,
  fallback: unknown,
  itemIndex: number,
): ValidationIssue {
  const source = isJsonObject(value) ? value : {};
  const parent = isJsonObject(fallback) ? fallback : {};
  return {
    code: text(source.code) ?? text(parent.error),
    field: field(source.references),
    message:
      text(source.message) ??
      text(parent.message) ??
      'Mercado Libre rechazo la publicacion',
    itemIndex,
  };
}

function field(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return (
    value.find((entry): entry is string => typeof entry === 'string') ?? null
  );
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
