import { ConflictException } from '@nestjs/common';

import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import type { MercadoLibreUserProduct } from '../../mercadolibre/user-products/user-product.types';
import type {
  ReplicableProduct,
  ReplicableProductVariant,
} from './tiendanube-replication.types';
import type { SourceAttribute } from './mercadolibre-replication-normalizer.helpers';
import {
  chooseVariantAttributes,
  findSku,
  metadata,
  parseItemAttributes,
  parsePictures,
  parseUserProductAttributes,
  TECHNICAL_ATTRIBUTE_IDS,
  text,
  uniqueStrings,
  validPrice,
  validStock,
  valuesForAttributes,
} from './mercadolibre-replication-normalizer.helpers';

export type FamilyOffer = Readonly<{
  item: MercadoLibrePublication;
  description: string | null;
}>;

export type FamilyNormalizationInput = Readonly<{
  userProductIds: readonly string[];
  userProducts: readonly MercadoLibreUserProduct[];
  offers: readonly FamilyOffer[];
}>;

type LogicalVariant = Readonly<{
  title: string;
  description: string | null;
  sourceItem: MercadoLibrePublication;
  attributes: readonly SourceAttribute[];
  pictures: readonly string[];
  variant: Omit<ReplicableProductVariant, 'values'>;
}>;

export function normalizeFamilyProduct(
  input: FamilyNormalizationInput,
): ReplicableProduct {
  const allowedIds = new Set(input.userProductIds);
  const offersByUserProduct = groupOffers(input.offers, allowedIds);
  const userProducts = new Map(
    input.userProducts.map((userProduct) => [userProduct.id, userProduct]),
  );
  const logicalVariants = input.userProductIds.flatMap((userProductId) => {
    const offers = offersByUserProduct.get(userProductId) ?? [];
    const logical = buildLogicalVariant(
      userProductId,
      offers,
      userProducts.get(userProductId),
    );
    return logical ? [logical] : [];
  });
  if (logicalVariants.length === 0)
    throw new ConflictException(
      'La familia no tiene ofertas con precio y stock válidos',
    );

  const attributes = chooseVariantAttributes(
    logicalVariants.map(({ attributes: source }) => source),
  );
  const primaryImages = logicalVariants.flatMap(
    ({ pictures }) => pictures[0] ?? [],
  );
  const images = uniqueStrings([
    ...primaryImages,
    ...logicalVariants.flatMap(({ pictures }) => pictures),
  ]);
  const variants = logicalVariants.map(({ attributes: source, variant }) => ({
    ...variant,
    values: valuesForAttributes(source, attributes),
  }));
  const anchor = logicalVariants[0];

  return {
    title: anchor.title,
    description:
      logicalVariants.flatMap(({ description }) =>
        description?.trim() ? [description.trim()] : [],
      )[0] ?? null,
    images,
    attributes,
    variants,
    ...metadata(anchor.sourceItem),
  };
}

function groupOffers(
  offers: readonly FamilyOffer[],
  allowedIds: ReadonlySet<string>,
): Map<string, FamilyOffer[]> {
  const result = new Map<string, FamilyOffer[]>();
  for (const offer of offers) {
    const userProductId = text(offer.item.user_product_id);
    if (!userProductId || !allowedIds.has(userProductId)) continue;
    const group = result.get(userProductId) ?? [];
    group.push(offer);
    result.set(userProductId, group);
  }
  return result;
}

function buildLogicalVariant(
  userProductId: string,
  offers: readonly FamilyOffer[],
  userProduct: MercadoLibreUserProduct | undefined,
): LogicalVariant | null {
  if (offers.length === 0) return null;
  const prices = offers.flatMap(({ item }) => validPrice(item.price) ?? []);
  const stocks = offers.flatMap(
    ({ item }) => validStock(item.available_quantity) ?? [],
  );
  if (prices.length === 0 || stocks.length === 0) return null;

  const canonical = parseUserProductAttributes(userProduct?.attributes).filter(
    ({ id }) => !TECHNICAL_ATTRIBUTE_IDS.has(id),
  );
  const fallback = consensusOfferAttributes(offers);
  const attributes = mergeCanonicalAttributes(canonical, fallback);
  const pictures = parsePictures(userProduct?.pictures).map(({ src }) => src);
  const skus = uniqueStrings(
    offers.flatMap(({ item }) => findSku(item.attributes) ?? []),
  );
  const sourceItem = offers[0].item;
  const title = offers.flatMap(({ item }) => text(item.title) ?? [])[0];
  if (!title)
    throw new ConflictException(
      `El User Product ${userProductId} no tiene un título válido`,
    );

  return {
    title,
    description:
      offers.flatMap(({ description }) =>
        description?.trim() ? [description.trim()] : [],
      )[0] ?? null,
    sourceItem,
    attributes,
    pictures,
    variant: {
      price: Math.min(...prices),
      stock: Math.max(...stocks),
      sku: skus.length === 1 ? skus[0] : null,
      ...(pictures[0] ? { imageSrc: pictures[0] } : {}),
    },
  };
}

function consensusOfferAttributes(
  offers: readonly FamilyOffer[],
): SourceAttribute[] {
  const parsed = offers.map(({ item }) =>
    parseItemAttributes(item.attributes).filter(
      ({ id }) => !TECHNICAL_ATTRIBUTE_IDS.has(id),
    ),
  );
  const ids = uniqueStrings(
    parsed.flatMap((attributes) => attributes.map(({ id }) => id)),
  );
  return ids.flatMap((id) => {
    const candidates = parsed.flatMap((attributes) =>
      attributes.filter((attribute) => attribute.id === id),
    );
    const values = new Set(candidates.map(({ value }) => value));
    const names = new Set(
      candidates.map(({ name }) => name.toLocaleLowerCase()),
    );
    return candidates.length > 0 && values.size === 1 && names.size === 1
      ? [candidates[0]]
      : [];
  });
}

function mergeCanonicalAttributes(
  canonical: readonly SourceAttribute[],
  fallback: readonly SourceAttribute[],
): SourceAttribute[] {
  const result = new Map<string, SourceAttribute>();
  for (const attribute of fallback) result.set(attribute.id, attribute);
  for (const attribute of canonical) result.set(attribute.id, attribute);
  return [...result.values()];
}
