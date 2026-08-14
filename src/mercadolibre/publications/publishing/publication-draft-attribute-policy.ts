import { BadRequestException } from '@nestjs/common';
import type {
  PublicationCategorySchema,
  PublicationSchemaAttribute,
} from './publication-categories.service';
import type {
  DraftAttribute,
  PublicationDraft,
} from './publication-publishing.types';

export function assertDraftAttributes(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
  usesUserProducts: boolean,
): void {
  const definitions = new Map(
    schema.attributes.map((value) => [value.id, value]),
  );
  validateAttributes(draft.attributes, definitions, false, 'attributes');
  validateRequiredCommon(draft, schema.attributes);
  validateSaleTerms(draft, schema);
  validateVariations(draft, schema, definitions, usesUserProducts);
}

function validateRequiredCommon(
  draft: PublicationDraft,
  definitions: readonly PublicationSchemaAttribute[],
): void {
  const present = new Set(draft.attributes.map(({ id }) => id));
  for (const definition of definitions) {
    const required =
      definition.required ||
      (definition.requiredOnNew && draft.condition === 'new');
    if (
      required &&
      definition.inputAllowed &&
      definition.id !== 'ITEM_CONDITION' &&
      definition.role !== 'CHILD_PK' &&
      !present.has(definition.id)
    ) {
      throw new BadRequestException(
        `Falta el atributo requerido ${definition.id}`,
      );
    }
  }
}

function validateSaleTerms(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
): void {
  const definitions = new Map(
    schema.saleTerms.map((value) => [value.id, value]),
  );
  validateAttributes(draft.saleTerms, definitions, false, 'saleTerms');
  const present = new Set(draft.saleTerms.map(({ id }) => id));
  for (const definition of schema.saleTerms) {
    if (
      definition.required &&
      definition.inputAllowed &&
      !present.has(definition.id)
    ) {
      throw new BadRequestException(
        `Falta el termino de venta ${definition.id}`,
      );
    }
  }
  if (
    draft.condition === 'refurbished' &&
    (!present.has('WARRANTY_TYPE') || !present.has('WARRANTY_TIME'))
  ) {
    throw new BadRequestException(
      'Los reacondicionados requieren WARRANTY_TYPE y WARRANTY_TIME',
    );
  }
}

function validateVariations(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
  definitions: ReadonlyMap<string, PublicationSchemaAttribute>,
  usesUserProducts: boolean,
): void {
  const children = schema.attributes.filter(
    ({ role, inputAllowed, variationAttribute }) =>
      role === 'CHILD_PK' && inputAllowed && !variationAttribute,
  );
  if (children.length > 0 && draft.variations.length === 0) {
    throw new BadRequestException('La categoria requiere al menos una variante');
  }
  const childIds = children.map(({ id }) => id);
  const knownChildIds = new Set(childIds);
  let expectedChildIds: Set<string> | null = null;
  const tuples = new Set<string>();
  for (let index = 0; index < draft.variations.length; index += 1) {
    const variation = draft.variations[index];
    validateAttributes(
      variation.attributes,
      definitions,
      true,
      `variations[${index}].attributes`,
    );
    const values = new Map(
      variation.attributes.map((value) => [value.id, value]),
    );
    const variationChildIds = new Set(
      variation.attributes
        .filter(({ id }) => knownChildIds.has(id))
        .map(({ id }) => id),
    );
    expectedChildIds ??= variationChildIds;
    if (!sameIds(variationChildIds, expectedChildIds)) {
      throw new BadRequestException(
        `variations[${index}] debe informar el mismo conjunto de atributos de variante`,
      );
    }
    for (const child of children) {
      const required =
        child.required || (child.requiredOnNew && draft.condition === 'new');
      if (required && !values.has(child.id)) {
        throw new BadRequestException(
          `variations[${index}] requiere el child PK ${child.id}`,
        );
      }
    }
    if (
      !usesUserProducts &&
      schema.settings.maxPicturesPerVariation !== null &&
      (variation.pictures.length || draft.pictures.length) >
        schema.settings.maxPicturesPerVariation
    ) {
      throw new BadRequestException(
        `variations[${index}].pictures admite hasta ${schema.settings.maxPicturesPerVariation} elementos`,
      );
    }
    if (!usesUserProducts && variation.price !== draft.price) {
      throw new BadRequestException(
        'El modelo tradicional usa un unico precio para todas las variaciones',
      );
    }
    const tuple = children
      .map(({ id }) => `${id}:${attributeValue(values.get(id))}`)
      .join('|');
    if (tuple && tuples.has(tuple)) {
      throw new BadRequestException(
        'Las variantes no pueden repetir sus child PK',
      );
    }
    if (tuple) tuples.add(tuple);
  }
}

function sameIds(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function validateAttributes(
  attributes: readonly DraftAttribute[],
  definitions: ReadonlyMap<string, PublicationSchemaAttribute>,
  variation: boolean,
  field: string,
): void {
  for (const attribute of attributes) {
    const definition = definitions.get(attribute.id);
    if (!definition || !definition.inputAllowed) {
      throw new BadRequestException(
        `${field} contiene ${attribute.id} no permitido`,
      );
    }
    if (variation !== (definition.role === 'CHILD_PK')) {
      throw new BadRequestException(
        `${attribute.id} fue enviado en un nivel incorrecto`,
      );
    }
    const value = attribute.valueName ?? '';
    if (definition.valueMaxLength && value.length > definition.valueMaxLength) {
      throw new BadRequestException(
        `${attribute.id} supera su longitud maxima`,
      );
    }
    if (
      attribute.valueId &&
      definition.values.length > 0 &&
      !definition.values.some(({ id }) => id === attribute.valueId)
    ) {
      throw new BadRequestException(
        `El valor de ${attribute.id} no esta permitido`,
      );
    }
  }
}

function attributeValue(value: DraftAttribute | undefined): string {
  return value?.valueId ?? value?.valueName ?? '';
}
