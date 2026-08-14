import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  ManagedPicture,
  parseLiveVariations,
} from './publication-management.types';
import {
  addPictureToVariation,
  hasSamePictureIds,
  PictureMutation,
  PictureSelector,
  picturePayload,
} from './publication-pictures.helpers';

type Variations = ReturnType<typeof parseLiveVariations>;

export function createPictureAddPayload(
  pictures: ManagedPicture[],
  variations: Variations,
  input: PictureMutation,
) {
  if (pictures.some(({ id }) => id === input.pictureId)) {
    throw new ConflictException('La imagen ya esta asociada');
  }
  const nextPictures = [...pictures, { id: input.pictureId }];
  const nextVariations = addPictureToVariation(
    variations,
    input.variationId,
    input.pictureId,
  );
  return picturePayload(nextPictures, nextVariations);
}

export function createPictureRemovePayload(
  pictures: ManagedPicture[],
  variations: Variations,
  input: PictureMutation,
) {
  const nextPictures = pictures.filter(({ id }) => id !== input.pictureId);
  if (nextPictures.length === pictures.length) {
    throw new NotFoundException('La imagen no esta asociada');
  }
  if (nextPictures.length === 0) {
    throw new ConflictException('La galeria no puede quedar vacia');
  }
  const nextVariations = variations.map((variation) => ({
    ...variation,
    picture_ids: variation.picture_ids.filter((id) => id !== input.pictureId),
  }));
  if (nextVariations.some(({ picture_ids }) => picture_ids.length === 0)) {
    throw new ConflictException('Una variacion no puede quedar sin imagen');
  }
  return picturePayload(nextPictures, nextVariations);
}

export function createPictureReplacePayload(
  pictures: ManagedPicture[],
  variations: Variations,
  input: PictureSelector & {
    pictureId: string;
    replacementPictureId: string;
  },
) {
  if (!pictures.some(({ id }) => id === input.pictureId)) {
    throw new NotFoundException('La imagen a reemplazar no esta asociada');
  }
  if (pictures.some(({ id }) => id === input.replacementPictureId)) {
    throw new ConflictException('La imagen nueva ya esta asociada');
  }
  return picturePayload(
    pictures.map(({ id }) => ({
      id: id === input.pictureId ? input.replacementPictureId : id,
    })),
    variations.map((variation) => ({
      ...variation,
      picture_ids: variation.picture_ids.map((id) =>
        id === input.pictureId ? input.replacementPictureId : id,
      ),
    })),
  );
}

export function createPictureReorderPayload(
  pictures: ManagedPicture[],
  variations: Variations,
  pictureIds: string[],
) {
  if (!hasSamePictureIds(pictures.map(({ id }) => id), pictureIds)) {
    throw new BadRequestException(
      'pictureIds debe ser una permutacion exacta de la galeria',
    );
  }
  return picturePayload(
    pictureIds.map((id) => ({ id })),
    variations,
  );
}
