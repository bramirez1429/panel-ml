import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DescriptionService } from '../../mercadolibre/direct-publications/description/description.service';
import { PublicationSourceService } from '../../mercadolibre/publications/sync/publication-source.service';
import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import { UserProductFamilyService } from '../../mercadolibre/user-products/user-product-family.service';
import { MercadoLibreToTiendanubeMapper } from './mercadolibre-to-tiendanube.mapper';
import type {
  ReplicableProduct,
  TiendanubeCreateProductDto,
} from './tiendanube-replication.types';
import {
  collectSkus,
  metadata,
  sku,
  valuesFor,
  varyingAttributes,
} from './mercadolibre-replication-source-resolver.helpers';

type SourceResult = Readonly<{
  sourceKey: string;
  product: TiendanubeCreateProductDto;
  skus: readonly string[];
}>;

@Injectable()
export class MercadoLibreReplicationSourceResolver {
  constructor(
    private readonly publicationSource: PublicationSourceService,
    private readonly familyService: UserProductFamilyService,
    private readonly descriptionService: DescriptionService,
  ) {}

  async resolve(
    sourceKey: string,
    sellerId: number,
    accessToken: string,
  ): Promise<SourceResult> {
    const itemMatch = /^item:(MLA\d+)$/u.exec(sourceKey);
    if (itemMatch)
      return this.resolveItem(sourceKey, itemMatch[1], sellerId, accessToken);

    const familyMatch = /^family:([1-9]\d*)$/u.exec(sourceKey);
    if (familyMatch)
      return this.resolveFamily(
        sourceKey,
        familyMatch[1],
        sellerId,
        accessToken,
      );

    throw new NotFoundException('sourceKey de Mercado Libre inválido');
  }

  private async resolveItem(
    sourceKey: string,
    itemId: string,
    sellerId: number,
    accessToken: string,
  ): Promise<SourceResult> {
    const item = await this.publicationSource.getItemWithAllAttributes(
      itemId,
      accessToken,
    );
    this.assertSeller(item, sellerId);
    const title = requireText(item.title);
    const description = await this.descriptionService.getPlainTextByItemId(
      itemId,
      accessToken,
    );
    const variations = Array.isArray(item.variations) ? item.variations : [];
    const variationAttributes = variations.map((value) =>
      combinationAttributes(value),
    );
    const attributes = varyingCombinationAttributes(variationAttributes);
    const rawProduct: ReplicableProduct = {
      title,
      description,
      images: pictures(item.pictures),
      attributes,
      variants:
        variations.length === 0
          ? [variant(item, [], requirePrice(item.price))]
          : variations.map((value, index) =>
              variation(
                value,
                valuesForCombinations(variationAttributes[index], attributes),
              ),
            ),
      ...metadata(item),
    };
    const product = MercadoLibreToTiendanubeMapper.map(rawProduct);
    return { sourceKey, product, skus: collectSkus(rawProduct) };
  }

  private async resolveFamily(
    sourceKey: string,
    familyId: string,
    sellerId: number,
    accessToken: string,
  ): Promise<SourceResult> {
    const cache = this.familyService.createCache();
    const family = await this.familyService.getFamily(
      familyId,
      accessToken,
      cache,
    );
    if (family.userId !== sellerId)
      throw new ForbiddenException(
        'La familia no pertenece al seller conectado',
      );
    const itemIds = await this.publicationSource.getItemIdsForUserProducts(
      sellerId,
      family.userProductIds,
      accessToken,
    );
    const items = await Promise.all(
      itemIds.map((id) =>
        this.publicationSource.getItemWithAllAttributes(id, accessToken),
      ),
    );
    const owned = items.filter((item) => {
      this.assertSeller(item, sellerId);
      return family.userProductIds.includes(String(item.user_product_id));
    });
    if (owned.length !== family.userProductIds.length)
      throw new ConflictException(
        'La familia de Mercado Libre está incompleta',
      );
    const descriptions = await Promise.all(
      owned.map((item) =>
        this.descriptionService.getPlainTextByItemId(
          requireItemId(item.id),
          accessToken,
        ),
      ),
    );
    const distinctDescriptions = [
      ...new Set(
        descriptions.filter((value): value is string => Boolean(value?.trim())),
      ),
    ];
    if (distinctDescriptions.length > 1)
      throw new ConflictException(
        'La familia tiene descripciones incompatibles',
      );
    const attributes = varyingAttributes(owned);
    const userProducts = await Promise.all(
      family.userProductIds.map((id) =>
        this.familyService.getUserProduct(id, accessToken, cache),
      ),
    );
    const rawProduct: ReplicableProduct = {
      title: requireText(owned[0].title),
      description: distinctDescriptions[0] ?? null,
      images: userProducts.flatMap((userProduct) =>
        pictures(userProduct.pictures),
      ),
      attributes,
      variants: owned.map((item) =>
        variant(item, valuesFor(item, attributes), requirePrice(item.price)),
      ),
      ...metadata(owned[0]),
    };
    const product = MercadoLibreToTiendanubeMapper.map(rawProduct);
    return { sourceKey, product, skus: collectSkus(rawProduct) };
  }

  private assertSeller(item: MercadoLibrePublication, sellerId: number): void {
    if (item.seller_id !== sellerId)
      throw new ForbiddenException(
        'La publicación no pertenece al seller conectado',
      );
  }
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new ConflictException(
      'Mercado Libre devolvió una publicación sin título',
    );
  return value.trim();
}

function pictures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { secure_url?: unknown; url?: unknown };
    const url = candidate.secure_url ?? candidate.url;
    return typeof url === 'string' && url.trim() ? [url.trim()] : [];
  });
}

function variant(
  item: MercadoLibrePublication,
  values: ReplicableProduct['variants'][number]['values'],
  price: unknown,
) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)
    throw new ConflictException('Precio de Mercado Libre inválido');
  const stock = requireStock(item.available_quantity);
  if (!Number.isSafeInteger(stock) || stock < 0)
    throw new ConflictException('Stock de Mercado Libre inválido');
  return { price, stock, sku: sku(item.attributes), values };
}

function requirePrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ConflictException('Precio de Mercado Libre inválido');
  }
  return value;
}

function requireItemId(value: unknown): string {
  if (typeof value !== 'string' || !/^MLA\d+$/u.test(value)) {
    throw new ConflictException('MLA de Mercado Libre inválido');
  }
  return value;
}

function variation(
  value: unknown,
  values: ReplicableProduct['variants'][number]['values'],
): ReplicableProduct['variants'][number] {
  if (!value || typeof value !== 'object')
    throw new ConflictException('Variación de Mercado Libre inválida');
  const candidate = value as {
    price?: unknown;
    available_quantity?: unknown;
    attributes?: unknown;
    attribute_combinations?: unknown;
  };
  return variant(
    {
      available_quantity: candidate.available_quantity,
      attributes: candidate.attributes,
    },
    values,
    candidate.price,
  );
}

type CombinationAttribute = Readonly<{
  id: string;
  name: string;
  value: string;
}>;

function combinationAttributes(value: unknown): CombinationAttribute[] {
  if (!value || typeof value !== 'object') return [];
  const candidate = value as { attribute_combinations?: unknown };
  if (!Array.isArray(candidate.attribute_combinations)) return [];
  return candidate.attribute_combinations.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as {
      id?: unknown;
      name?: unknown;
      value_name?: unknown;
    };
    return typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.value_name === 'string' &&
      item.value_name.trim()
      ? [{ id: item.id, name: item.name, value: item.value_name.trim() }]
      : [];
  });
}

function varyingCombinationAttributes(
  combinations: readonly (readonly CombinationAttribute[])[],
): ReplicableProduct['attributes'] {
  const ids = [
    ...new Set(combinations.flatMap((items) => items.map((item) => item.id))),
  ];
  return ids.flatMap((id) => {
    const values = combinations.map(
      (items) => items.find((item) => item.id === id)?.value ?? null,
    );
    const candidate = combinations.flatMap((items) =>
      items.filter((item) => item.id === id),
    )[0];
    return candidate && new Set(values).size > 1
      ? [{ id, name: candidate.name }]
      : [];
  });
}

function valuesForCombinations(
  combinations: readonly CombinationAttribute[],
  attributes: readonly ReplicableProduct['attributes'][number][],
) {
  return attributes.map(({ id }) => ({
    attributeId: id,
    value: combinations.find((item) => item.id === id)?.value ?? '',
  }));
}

function requireStock(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ConflictException('Stock de Mercado Libre invalido');
  }
  return value as number;
}
