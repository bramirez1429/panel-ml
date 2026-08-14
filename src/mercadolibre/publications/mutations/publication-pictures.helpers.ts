import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';
import {
  parseLiveVariations,
  parseVariationId,
} from './publication-management.types';

export type PictureSelector = {
  itemId: unknown;
  variationId: string | null;
};

export type PictureMutation = PictureSelector & { pictureId: string };

export function parsePictureSelector(body: unknown): PictureSelector {
  if (!isJsonObject(body)) throw new BadRequestException('Body invalido');
  return {
    itemId: body.itemId,
    variationId:
      body.variationId === undefined || body.variationId === null
        ? null
        : parseVariationId(body.variationId),
  };
}

export function parsePictureMutation(body: unknown): PictureMutation {
  const selector = parsePictureSelector(body);
  if (!isJsonObject(body) || !isNonEmptyString(body.pictureId)) {
    throw new BadRequestException('pictureId es obligatorio');
  }
  return { ...selector, pictureId: body.pictureId.trim() };
}

export function parsePictureReplace(body: unknown) {
  const input = parsePictureMutation(body);
  if (!isJsonObject(body) || !isNonEmptyString(body.replacementPictureId)) {
    throw new BadRequestException('replacementPictureId es obligatorio');
  }
  return { ...input, replacementPictureId: body.replacementPictureId.trim() };
}

export function parsePictureReorder(body: unknown) {
  const selector = parsePictureSelector(body);
  if (
    !isJsonObject(body) ||
    !Array.isArray(body.pictureIds) ||
    body.pictureIds.length === 0 ||
    body.pictureIds.some((id) => !isNonEmptyString(id))
  ) {
    throw new BadRequestException('pictureIds es obligatorio');
  }
  const pictureIds = body.pictureIds.map((id) => (id as string).trim());
  if (new Set(pictureIds).size !== pictureIds.length) {
    throw new BadRequestException('pictureIds no admite duplicados');
  }
  return { ...selector, pictureIds };
}

export function normalizePictureReorderBody(
  body: Record<string, unknown>,
) {
  if (Array.isArray(body.pictureIds)) return body;
  if (!isNonEmptyString(body.pictureIds)) {
    throw new BadRequestException('pictureIds es obligatorio');
  }
  try {
    return { ...body, pictureIds: JSON.parse(body.pictureIds) as unknown };
  } catch {
    throw new BadRequestException('pictureIds debe ser un array JSON valido');
  }
}

export function validatePictureVariation(
  model: 'SHARED' | 'VARIANT_PRICING',
  variations: ReturnType<typeof parseLiveVariations>,
  variationId: string | null,
): void {
  if (model === 'VARIANT_PRICING' && variationId) {
    throw new BadRequestException(
      'variationId no corresponde a VARIANT_PRICING',
    );
  }
  if (variationId && !variations.some(({ id }) => String(id) === variationId)) {
    throw new NotFoundException('La variacion no existe');
  }
}

export function addPictureToVariation(
  variations: ReturnType<typeof parseLiveVariations>,
  variationId: string | null,
  pictureId: string,
) {
  if (variations.length === 0 || !variationId) return variations;
  return variations.map((variation) => ({
    ...variation,
    picture_ids:
      String(variation.id) === variationId
        ? [...variation.picture_ids, pictureId]
        : variation.picture_ids,
  }));
}

export function picturePayload(
  pictures: Array<{ id: string }>,
  variations: ReturnType<typeof parseLiveVariations>,
) {
  return {
    pictures,
    ...(variations.length
      ? {
          variations: variations.map(({ id, picture_ids }) => ({
            id,
            picture_ids,
          })),
        }
      : {}),
  };
}

export function hasSamePictureIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
