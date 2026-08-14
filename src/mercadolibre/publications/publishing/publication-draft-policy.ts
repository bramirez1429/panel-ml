import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PublicationCategorySchema } from './publication-categories.service';
import { assertDraftAttributes } from './publication-draft-attribute-policy';
import { assertDraftPictures } from './publication-draft-picture-policy';
import type { PublicationDraft } from './publication-publishing.types';

export function assertDraftMatchesSchema(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
  usesUserProducts: boolean,
): void {
  if (schema.settings.listingAllowed === false) {
    throw new ConflictException('La categoria no permite nuevas publicaciones');
  }
  assertOption(schema.listingTypes, draft.listingTypeId, 'listingTypeId');
  assertOption(schema.conditions, draft.condition, 'condition');
  assertDraftPictures(draft, schema, usesUserProducts);
  assertMaximum(
    draft.variations.length,
    schema.settings.maxVariations,
    'variations',
  );
  assertTextMaximum(draft.title, schema.settings.maxTitleLength, 'title');
  assertTextMaximum(
    draft.familyName,
    schema.settings.maxTitleLength,
    'familyName',
  );

  assertDraftAttributes(draft, schema, usesUserProducts);
}

function assertOption(
  options: readonly Readonly<{ id: string }>[],
  selected: string,
  field: string,
): void {
  if (options.length > 0 && !options.some(({ id }) => id === selected)) {
    throw new BadRequestException(`${field} no esta permitido`);
  }
}

function assertMaximum(
  value: number,
  maximum: number | null,
  field: string,
): void {
  if (maximum !== null && value > maximum) {
    throw new BadRequestException(`${field} admite hasta ${maximum} elementos`);
  }
}

function assertTextMaximum(
  value: string | null,
  maximum: number | null,
  field: string,
): void {
  if (value && maximum !== null && value.length > maximum) {
    throw new BadRequestException(
      `${field} admite hasta ${maximum} caracteres`,
    );
  }
}
