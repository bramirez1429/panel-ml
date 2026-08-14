import { BadRequestException } from '@nestjs/common';
import type { PublicationCategorySchema } from './publication-categories.service';
import type { PublicationDraft } from './publication-publishing.types';

export function assertDraftPictures(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
  usesUserProducts: boolean,
): void {
  if (usesUserProducts) {
    const itemGalleries = draft.variations.length
      ? draft.variations.map(({ pictures }) =>
          pictures.length ? pictures : draft.pictures,
        )
      : [draft.pictures];
    itemGalleries.forEach((pictures, index) =>
      assertMaximum(
        new Set(pictures).size,
        schema.settings.maxPictures,
        `items[${index}].pictures`,
      ),
    );
    return;
  }

  const gallery = new Set([
    ...draft.pictures,
    ...draft.variations.flatMap(({ pictures }) => pictures),
  ]);
  assertMaximum(gallery.size, schema.settings.maxPictures, 'pictures');
  assertDefinesPicture(draft, schema);
}

function assertDefinesPicture(
  draft: PublicationDraft,
  schema: PublicationCategorySchema,
): void {
  const definition = schema.attributes.find(
    ({ definesPicture, role }) => definesPicture && role === 'CHILD_PK',
  );
  if (!definition || draft.variations.length < 2) return;

  const picturesByValue = new Map<string, string>();
  const valuesByPictures = new Map<string, string>();
  for (const variation of draft.variations) {
    const attribute = variation.attributes.find(
      ({ id }) => id === definition.id,
    );
    const value = attribute?.valueId ?? attribute?.valueName;
    if (!value) continue;
    const pictures = variation.pictures.length
      ? variation.pictures
      : draft.pictures;
    const signature = [...pictures].sort().join('|');
    const previousPictures = picturesByValue.get(value);
    if (previousPictures !== undefined && previousPictures !== signature) {
      throw new BadRequestException(
        `${definition.id} debe reutilizar las mismas imagenes para el mismo valor`,
      );
    }
    const previousValue = valuesByPictures.get(signature);
    if (previousValue !== undefined && previousValue !== value) {
      throw new BadRequestException(
        `${definition.id} requiere imagenes diferentes para valores distintos`,
      );
    }
    picturesByValue.set(value, signature);
    valuesByPictures.set(signature, value);
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
