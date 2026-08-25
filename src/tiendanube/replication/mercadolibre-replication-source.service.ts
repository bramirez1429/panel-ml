import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreChildrenRepository } from '../../database/repositories/mercadolibre-children.repository';
import type {
  MercadolibreChildRow,
  MercadolibreProductDetail,
} from '../../database/repositories/mercadolibre-publications.types';
import { DescriptionService } from '../../mercadolibre/direct-publications/description/description.service';
import {
  textOrNull,
  varyingAttributeIds,
} from '../../mercadolibre/publications/normalization/publication-normalizer.helpers';
import type {
  MercadoLibrePublication,
  ReducedAttribute,
} from '../../mercadolibre/publications/publication.types';
import { PublicationSourceService } from '../../mercadolibre/publications/sync/publication-source.service';
import { PublicationsMapper } from '../../mercadolibre/direct-publications/publications/publications.mapper';
import type { MlItem } from '../../mercadolibre/direct-publications/items/items.types';
import { UserProductFamilyService } from '../../mercadolibre/user-products/user-product-family.service';
import type { MercadoLibreUserProduct } from '../../mercadolibre/user-products/user-product.types';
import type {
  ReplicableProduct,
  ReplicableProductAttribute,
  ReplicableProductVariant,
  ReplicableProductVariantValue,
} from './tiendanube-replication.types';

type SourceAttribute = Readonly<{
  id: string;
  name: string;
  value: string;
}>;

type SourcePicture = Readonly<{
  secure_url?: unknown;
  url?: unknown;
}>;

type ReplicableDimensions = Readonly<{
  weight?: number;
  width?: number;
  height?: number;
  depth?: number;
}>;

type ReplicableProductWithoutDescription = Omit<
  ReplicableProduct,
  'description'
>;

const TECHNICAL_ATTRIBUTE_IDS = new Set([
  'EMPTY_GTIN_REASON',
  'GTIN',
  'ITEM_CONDITION',
  'MPN',
  'SELLER_SKU',
]);

@Injectable()
export class MercadoLibreReplicationSourceService {
  constructor(
    private readonly childrenRepository: MercadolibreChildrenRepository,
    private readonly publicationSourceService: PublicationSourceService,
    private readonly userProductFamilyService: UserProductFamilyService,
    private readonly descriptionService: DescriptionService,
  ) {}

  async load(
    product: MercadolibreProductDetail,
    sellerId: number,
    accessToken: string,
  ): Promise<ReplicableProduct> {
    this.validateAnchor(product, sellerId);

    return product.model === 'SHARED'
      ? this.loadShared(product, sellerId, accessToken)
      : this.loadVariantPricing(product, sellerId, accessToken);
  }

  private async loadShared(
    product: MercadolibreProductDetail,
    sellerId: number,
    accessToken: string,
  ): Promise<ReplicableProduct> {
    const itemId = requireItemId(product.parent_item_id);
    if (product.external_key !== `item:${itemId}`) {
      throw new ConflictException(
        'La publicación SHARED guardada tiene una clave inconsistente',
      );
    }

    const item = await this.publicationSourceService.getItemWithAllAttributes(
      itemId,
      accessToken,
    );
    this.requireOwnedItem(item, itemId, sellerId);
    if (
      PublicationsMapper.getModel(toModelDetectionItem(item, itemId)) !==
      'SHARED'
    ) {
      throw new ConflictException('La publicación ya no usa el modelo SHARED');
    }

    const title = requireText(item.title, 'La publicación no tiene título');
    const images = parsePictures(item.pictures);
    const price = requirePrice(item.price);
    const rawVariations = item.variations;
    if (
      rawVariations !== undefined &&
      rawVariations !== null &&
      !Array.isArray(rawVariations)
    ) {
      throw invalidMlResponse();
    }

    const source =
      Array.isArray(rawVariations) && rawVariations.length > 0
        ? this.buildSharedProduct(title, images, price, rawVariations)
        : {
            title,
            images,
            attributes: [],
            variants: [
              {
                price,
                stock: requireStock(item.available_quantity),
                sku: findSku(item.attributes),
                values: [],
              },
            ],
          };
    const description = normalizeDescription(
      await this.descriptionService.getPlainTextByItemId(itemId, accessToken),
    );
    const metadata = buildProductMetadata([item]);
    const dimensions = parseDimensions(item.shipping);

    return {
      ...source,
      ...metadata,
      description,
      variants: applyDimensions(source.variants, dimensions),
    };
  }

  private buildSharedProduct(
    title: string,
    images: readonly string[],
    price: number,
    rawVariations: readonly unknown[],
  ): ReplicableProductWithoutDescription {
    const parsed = rawVariations.map((value) => {
      if (!isJsonObject(value)) throw invalidMlResponse();
      const combinations = parseAttributes(value.attribute_combinations);
      if (combinations.length === 0) {
        throw new ConflictException(
          'Las variaciones SHARED no tienen atributos que las definan',
        );
      }
      return {
        ...parseDimensions(value.shipping),
        combinations,
        price: requireVariationPrice(value.price, price),
        stock: requireStock(value.available_quantity),
        sku: findSku(value.attributes),
      };
    });

    const attributes = defineSharedAttributes(
      parsed.map(({ combinations }) => combinations),
    );
    if (attributes.length > 3) {
      throw new ConflictException(
        'La publicación tiene más de 3 atributos de variación',
      );
    }

    const variants = parsed.map(({ combinations, ...variant }) => ({
      ...variant,
      values: buildOrderedValues(combinations, attributes),
    }));
    ensureUniqueVariantCombinations(variants);

    return {
      title,
      images,
      attributes,
      variants,
    };
  }

  private async loadVariantPricing(
    product: MercadolibreProductDetail,
    sellerId: number,
    accessToken: string,
  ): Promise<ReplicableProduct> {
    const familyId = requireFamilyId(product.family_id);
    if (product.external_key !== `family:${familyId}`) {
      throw new ConflictException(
        'La familia guardada tiene una clave inconsistente',
      );
    }

    const children = await this.childrenRepository.findByProductId(product.id);
    const storedUserProductIds = this.validateStoredChildren(
      children,
      product.id,
    );
    const cache = this.userProductFamilyService.createCache();
    const family = await this.userProductFamilyService.getFamily(
      familyId,
      accessToken,
      cache,
    );
    if (family.userId !== sellerId) {
      throw new ForbiddenException(
        'La familia no pertenece al seller conectado',
      );
    }
    requireSameSet(
      storedUserProductIds,
      family.userProductIds,
      'La familia guardada no coincide con sus variantes reales',
    );

    const itemIds =
      await this.publicationSourceService.getItemIdsForUserProducts(
        sellerId,
        family.userProductIds,
        accessToken,
      );
    if (itemIds.length === 0) {
      throw new BadGatewayException(
        'Mercado Libre no devolvió publicaciones para la familia',
      );
    }

    const itemByUserProduct = new Map<string, MercadoLibrePublication>();
    for (const itemId of itemIds) {
      const item = await this.publicationSourceService.getItemWithAllAttributes(
        itemId,
        accessToken,
      );
      this.requireOwnedItem(item, itemId, sellerId);
      const itemFamilyId = requireFamilyId(item.family_id);
      const userProductId = requireUserProductId(item.user_product_id);
      if (
        itemFamilyId !== familyId ||
        !family.userProductIds.includes(userProductId)
      ) {
        throw new ForbiddenException(
          'Un MLA no pertenece a la familia seleccionada',
        );
      }
      if (itemByUserProduct.has(userProductId)) {
        throw ambiguousUserProduct(userProductId);
      }
      itemByUserProduct.set(userProductId, item);
    }

    for (const userProductId of family.userProductIds) {
      if (!itemByUserProduct.has(userProductId)) {
        throw new BadGatewayException(
          'Mercado Libre devolvió una familia incompleta',
        );
      }
    }

    const orderedItems = family.userProductIds.map(
      (userProductId) =>
        itemByUserProduct.get(userProductId) as MercadoLibrePublication,
    );
    const title = requireConsistentFamilyTitle(orderedItems);
    const parsedAttributes = orderedItems.map((item) =>
      parseAttributes(item.attributes, true).filter(
        ({ id }) => !TECHNICAL_ATTRIBUTE_IDS.has(id),
      ),
    );
    const attributes = defineVaryingAttributes(parsedAttributes);
    if (attributes.length > 3) {
      throw new ConflictException(
        'La familia tiene más de 3 atributos de variación',
      );
    }
    if (orderedItems.length > 1 && attributes.length === 0) {
      throw new ConflictException(
        'No se pueden distinguir las variantes reales de la familia',
      );
    }

    const descriptions: Array<string | null> = [];
    for (const item of orderedItems) {
      descriptions.push(
        await this.descriptionService.getPlainTextByItemId(
          requireItemId(item.id),
          accessToken,
        ),
      );
    }
    const description = requireConsistentFamilyDescription(descriptions);
    const metadata = buildProductMetadata(orderedItems);

    const userProducts: MercadoLibreUserProduct[] = [];
    for (const userProductId of family.userProductIds) {
      userProducts.push(
        await this.userProductFamilyService.getUserProduct(
          userProductId,
          accessToken,
          cache,
        ),
      );
    }
    const images = deduplicateStrings(
      userProducts.flatMap((userProduct) =>
        parsePictures(userProduct.pictures),
      ),
    );

    const variants = orderedItems.map((item, index) => ({
      ...parseDimensions(item.shipping),
      price: requirePrice(item.price),
      stock: requireStock(item.available_quantity),
      sku: findSku(item.attributes),
      values: buildOrderedValues(parsedAttributes[index], attributes),
    }));
    ensureUniqueVariantCombinations(variants);

    return { title, description, images, attributes, variants, ...metadata };
  }

  private validateStoredChildren(
    children: readonly MercadolibreChildRow[],
    productId: string,
  ): string[] {
    if (children.length === 0) {
      throw new ConflictException('La familia guardada no tiene variantes');
    }

    const userProductIds: string[] = [];
    const seen = new Set<string>();
    for (const child of children) {
      if (child.product_id !== productId) throw invalidMlResponse();
      const userProductId = requireUserProductId(child.user_product_id);
      if (seen.has(userProductId)) throw ambiguousUserProduct(userProductId);
      seen.add(userProductId);
      userProductIds.push(userProductId);
    }
    return userProductIds;
  }

  private validateAnchor(
    product: MercadolibreProductDetail,
    sellerId: number,
  ): void {
    if (
      product.seller_id !== sellerId ||
      !Number.isSafeInteger(sellerId) ||
      sellerId <= 0
    ) {
      throw new ForbiddenException(
        'La publicación no pertenece al seller conectado',
      );
    }
  }

  private requireOwnedItem(
    item: MercadoLibrePublication,
    itemId: string,
    sellerId: number,
  ): void {
    if (
      item.id !== itemId ||
      normalizePositiveInteger(item.seller_id) !== sellerId
    ) {
      throw new ForbiddenException('El MLA no pertenece al seller conectado');
    }
  }
}

function defineSharedAttributes(
  combinationsByVariant: readonly (readonly SourceAttribute[])[],
): ReplicableProductAttribute[] {
  const first = combinationsByVariant[0];
  const attributes = first.map(({ id, name }) => ({ id, name }));
  const expectedIds = new Set(attributes.map(({ id }) => id));
  if (expectedIds.size !== attributes.length) throw invalidMlResponse();

  for (const combinations of combinationsByVariant) {
    if (
      combinations.length !== attributes.length ||
      combinations.some(({ id }) => !expectedIds.has(id))
    ) {
      throw new ConflictException(
        'Las variaciones SHARED tienen combinaciones inconsistentes',
      );
    }
  }

  return attributes.filter(({ id }) => {
    const values = combinationsByVariant.map(
      (combinations) =>
        combinations.find((attribute) => attribute.id === id)?.value,
    );
    return new Set(values).size > 1;
  });
}

function defineVaryingAttributes(
  attributesByItem: readonly (readonly SourceAttribute[])[],
): ReplicableProductAttribute[] {
  const reduced: ReducedAttribute[][] = attributesByItem.map((attributes) =>
    attributes.map(({ id, value }) => ({ id, valueName: value })),
  );
  const varyingIds = varyingAttributeIds(reduced);
  const hasIncompleteDimension = varyingIds.some(
    (id) =>
      !attributesByItem.every((attributes) =>
        attributes.some((attribute) => attribute.id === id),
      ),
  );
  if (hasIncompleteDimension) {
    throw new ConflictException(
      'Una variante no tiene todos sus atributos definitorios',
    );
  }

  return varyingIds.map((id) => {
    const candidates = attributesByItem.flatMap((attributes) =>
      attributes.filter((attribute) => attribute.id === id),
    );
    const names = new Set(candidates.map(({ name }) => name));
    if (names.size !== 1) throw invalidMlResponse();
    return { id, name: candidates[0].name };
  });
}

function parseAttributes(
  value: unknown,
  skipMissingValues = false,
): SourceAttribute[] {
  if (!Array.isArray(value)) return [];
  const attributes: SourceAttribute[] = [];
  const ids = new Set<string>();

  for (const candidate of value) {
    if (!isJsonObject(candidate)) throw invalidMlResponse();
    const id = textOrNull(candidate.id);
    const name = textOrNull(candidate.name) ?? id;
    const attributeValue =
      textOrNull(candidate.value_name) ?? firstAttributeValue(candidate.values);
    if (!id || !name || ids.has(id)) {
      throw invalidMlResponse();
    }
    if (!attributeValue && skipMissingValues) continue;
    if (!attributeValue) throw invalidMlResponse();
    ids.add(id);
    attributes.push({ id, name, value: attributeValue });
  }
  return attributes;
}

function firstAttributeValue(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const name = textOrNull(candidate.name);
    if (name) return name;
  }
  return null;
}

function buildOrderedValues(
  sourceAttributes: readonly SourceAttribute[],
  attributes: readonly ReplicableProductAttribute[],
): ReplicableProductVariantValue[] {
  return attributes.map(({ id }) => {
    const source = sourceAttributes.find((candidate) => candidate.id === id);
    if (!source) {
      throw new ConflictException(
        'Una variante no tiene todos sus atributos definitorios',
      );
    }
    return { attributeId: id, value: source.value };
  });
}

function findSku(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    if (!isJsonObject(candidate) || candidate.id !== 'SELLER_SKU') continue;
    return textOrNull(candidate.value_name);
  }
  return null;
}

function parsePictures(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalidMlResponse();
  return deduplicateStrings(
    value.flatMap((candidate) => {
      if (!isJsonObject(candidate)) throw invalidMlResponse();
      const picture = candidate as SourcePicture;
      const url = textOrNull(picture.secure_url) ?? textOrNull(picture.url);
      return url && isHttpUrl(url) ? [url] : [];
    }),
  );
}

function ensureUniqueVariantCombinations(
  variants: readonly ReplicableProductVariant[],
): void {
  const combinations = new Set<string>();
  for (const variant of variants) {
    const key = JSON.stringify(variant.values.map(({ value }) => value));
    if (combinations.has(key)) {
      throw new ConflictException(
        'La familia contiene variantes indistinguibles',
      );
    }
    combinations.add(key);
  }
}

function requireConsistentFamilyTitle(
  items: readonly MercadoLibrePublication[],
): string {
  const titles = new Set(
    items.flatMap((item) => textOrNull(item.family_name) ?? []),
  );
  if (titles.size !== 1) {
    throw new ConflictException(
      'Mercado Libre devolvió nombres de familia inconsistentes',
    );
  }
  return [...titles][0];
}

function requireConsistentFamilyDescription(
  descriptions: readonly (string | null)[],
): string | null {
  let uniqueDescription: string | null = null;
  for (const description of descriptions) {
    const normalized = normalizeDescription(description);
    if (!normalized) continue;
    if (uniqueDescription && normalized !== uniqueDescription) {
      throw new ConflictException(
        'La familia tiene descripciones diferentes entre sus publicaciones',
      );
    }
    uniqueDescription = normalized;
  }
  return uniqueDescription;
}

function normalizeDescription(value: string | null): string | null {
  return value?.trim() || null;
}

function buildProductMetadata(
  items: readonly MercadoLibrePublication[],
): Pick<ReplicableProduct, 'brand' | 'categoryIds' | 'tags'> {
  const brands = items
    .map((item) => findBrand(item.attributes))
    .filter((brand): brand is string => brand !== null);
  const uniqueBrands = [...new Set(brands)];
  if (uniqueBrands.length > 1) {
    throw new ConflictException(
      'Mercado Libre devolviÃ³ marcas inconsistentes',
    );
  }

  const tags = [
    ...new Set(
      items.flatMap((item) =>
        Array.isArray(item.tags)
          ? item.tags.flatMap((tag) => {
              if (typeof tag !== 'string' || !tag.trim()) return [];
              return [tag.trim()];
            })
          : [],
      ),
    ),
  ];
  const categoryIds = [
    ...new Set(items.flatMap((item) => findMappedCategoryIds(item) ?? [])),
  ];

  return {
    ...(uniqueBrands[0] ? { brand: uniqueBrands[0] } : {}),
    ...(categoryIds.length > 0 ? { categoryIds } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function findBrand(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const candidate of value) {
    if (!isJsonObject(candidate) || candidate.id !== 'BRAND') continue;
    const valueName = textOrNull(candidate.value_name);
    if (valueName) return valueName;
    if (!Array.isArray(candidate.values)) continue;
    for (const rawValue of candidate.values) {
      if (!isJsonObject(rawValue)) continue;
      const name = textOrNull(rawValue.name);
      if (name) return name;
    }
  }
  return null;
}

function findMappedCategoryIds(
  item: MercadoLibrePublication | undefined,
): readonly number[] | undefined {
  if (!item) return undefined;
  const rawIds = item.tiendanube_category_ids;
  if (Array.isArray(rawIds)) {
    const ids = rawIds.filter(
      (id): id is number =>
        typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    );
    return ids.length > 0 ? [...new Set(ids)] : undefined;
  }
  const singleId = item.tiendanube_category_id;
  return typeof singleId === 'number' &&
    Number.isSafeInteger(singleId) &&
    singleId > 0
    ? [singleId]
    : undefined;
}

function applyDimensions(
  variants: readonly ReplicableProductVariant[],
  dimensions: ReplicableDimensions,
): readonly ReplicableProductVariant[] {
  return variants.map((variant) => ({ ...dimensions, ...variant }));
}

function parseDimensions(value: unknown): ReplicableDimensions {
  if (!isJsonObject(value)) return {};

  const direct: ReplicableDimensions = {
    ...(readNonNegativeNumber(value.weight) !== null
      ? { weight: readNonNegativeNumber(value.weight) as number }
      : {}),
    ...(readNonNegativeNumber(value.width) !== null
      ? { width: readNonNegativeNumber(value.width) as number }
      : {}),
    ...(readNonNegativeNumber(value.height) !== null
      ? { height: readNonNegativeNumber(value.height) as number }
      : {}),
    ...(readNonNegativeNumber(value.depth) !== null
      ? { depth: readNonNegativeNumber(value.depth) as number }
      : {}),
  };
  if (Object.keys(direct).length > 0) return direct;

  if (typeof value.dimensions !== 'string') return {};
  const match = value.dimensions
    .trim()
    .match(
      /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)(g|kg))?$/i,
    );
  if (!match) return {};
  const weight = match[4] ? Number(match[4]) : null;
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    depth: Number(match[3]),
    ...(weight !== null
      ? { weight: match[5]?.toLowerCase() === 'g' ? weight / 1000 : weight }
      : {}),
  };
}

function readNonNegativeNumber(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function requireSameSet(
  left: readonly string[],
  right: readonly string[],
  message: string,
): void {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (
    leftSet.size !== rightSet.size ||
    [...leftSet].some((value) => !rightSet.has(value))
  ) {
    throw new ConflictException(message);
  }
}

function requirePrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BadGatewayException('Mercado Libre devolvió un precio inválido');
  }
  return value;
}

function requireVariationPrice(value: unknown, fallback: number): number {
  return value === undefined || value === null ? fallback : requirePrice(value);
}

function requireStock(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BadGatewayException('Mercado Libre devolvió un stock inválido');
  }
  return value;
}

function requireItemId(value: unknown): string {
  const itemId = textOrNull(value);
  if (!itemId || !/^MLA\d+$/.test(itemId)) throw invalidMlResponse();
  return itemId;
}

function requireUserProductId(value: unknown): string {
  const userProductId = textOrNull(value);
  if (!userProductId || !/^MLAU\d+$/.test(userProductId)) {
    throw invalidMlResponse();
  }
  return userProductId;
}

function requireFamilyId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  const familyId = textOrNull(value);
  if (!familyId || !/^[1-9]\d*$/.test(familyId)) throw invalidMlResponse();
  return familyId;
}

function requireText(value: unknown, message: string): string {
  const text = textOrNull(value);
  if (!text) throw new BadGatewayException(message);
  return text;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function deduplicateStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function ambiguousUserProduct(userProductId: string): ConflictException {
  return new ConflictException(
    `El User Product ${userProductId} tiene múltiples MLA con precio o stock ambiguos`,
  );
}

function invalidMlResponse(): BadGatewayException {
  return new BadGatewayException(
    'Mercado Libre devolvió datos de publicación inválidos',
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toModelDetectionItem(
  item: MercadoLibrePublication,
  itemId: string,
): MlItem {
  return {
    id: itemId,
    family_name: typeof item.family_name === 'string' ? item.family_name : null,
    family_id:
      typeof item.family_id === 'string' || typeof item.family_id === 'number'
        ? item.family_id
        : null,
    variations: Array.isArray(item.variations) ? item.variations : undefined,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string')
      : undefined,
  };
}
