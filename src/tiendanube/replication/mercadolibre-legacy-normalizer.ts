import { ConflictException } from '@nestjs/common';

import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import type { ReplicableProduct } from './tiendanube-replication.types';
import {
  chooseVariantAttributes,
  findSku,
  isJsonObject,
  metadata,
  parseItemAttributes,
  parsePictures,
  requirePrice,
  requireStock,
  requireText,
  text,
  uniqueStrings,
  validPrice,
  valuesForAttributes,
} from './mercadolibre-replication-normalizer.helpers';

export function normalizeLegacyProduct(
  item: MercadoLibrePublication,
  description: string | null,
): ReplicableProduct {
  const title = requireText(
    item.title,
    'Mercado Libre devolvió una publicación sin título',
  );
  const pictures = parsePictures(item.pictures);
  const rawVariations = item.variations;
  if (
    rawVariations !== undefined &&
    rawVariations !== null &&
    !Array.isArray(rawVariations)
  ) {
    throw new ConflictException('Variaciones de Mercado Libre inválidas');
  }
  if (!Array.isArray(rawVariations) || rawVariations.length === 0) {
    return {
      title,
      description,
      images: pictures.map(({ src }) => src),
      attributes: [],
      variants: [
        {
          price: requirePrice(item.price),
          stock: requireStock(item.available_quantity),
          sku: findSku(item.attributes),
          values: [],
        },
      ],
      ...metadata(item),
    };
  }

  const variations = rawVariations.map((value) => parseVariation(value, item));
  const primaryImages = variations.flatMap(({ pictureIds }) => {
    const picture = pictureIds.flatMap((id) =>
      pictures.filter((candidate) => candidate.id === id),
    )[0];
    return picture ? [picture.src] : [];
  });
  const images = uniqueStrings([
    ...primaryImages,
    ...pictures.map(({ src }) => src),
  ]);
  const attributes = chooseVariantAttributes(
    variations.map(({ combinations }) => combinations),
  );
  const variants = variations.map(
    ({ combinations, pictureIds, ...variant }) => ({
      ...variant,
      values: valuesForAttributes(combinations, attributes),
      ...variantPicture(pictureIds, pictures),
    }),
  );

  return {
    title,
    description,
    images,
    attributes,
    variants,
    ...metadata(item),
  };
}

function parseVariation(
  value: unknown,
  item: MercadoLibrePublication,
): Readonly<{
  price: number;
  stock: number;
  sku: string | null;
  combinations: ReturnType<typeof parseItemAttributes>;
  pictureIds: readonly string[];
}> {
  if (!isJsonObject(value))
    throw new ConflictException('Variación de Mercado Libre inválida');
  const combinations = parseItemAttributes(value.attribute_combinations);
  if (combinations.length === 0)
    throw new ConflictException(
      'Las variaciones no tienen atributos comerciales válidos',
    );
  const variationPrice = validPrice(value.price) ?? item.price;
  return {
    price: requirePrice(variationPrice),
    stock: requireStock(value.available_quantity),
    sku: findSku(value.attributes),
    combinations,
    pictureIds: Array.isArray(value.picture_ids)
      ? value.picture_ids.flatMap((id) => text(id) ?? [])
      : [],
  };
}

function variantPicture(
  pictureIds: readonly string[],
  pictures: ReturnType<typeof parsePictures>,
): Readonly<{ imageSrc?: string }> {
  for (const pictureId of pictureIds) {
    const picture = pictures.find(({ id }) => id === pictureId);
    if (picture) return { imageSrc: picture.src };
  }
  return {};
}
