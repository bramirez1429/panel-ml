import { Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../mercadolibre/auth/mercadolibre-token.service';
import { FamiliesService } from '../mercadolibre/direct-publications/families/families.service';
import type {
  MlAttribute,
  MlItem,
} from '../mercadolibre/direct-publications/items/items.types';
import { PublicationSourceService } from '../mercadolibre/publications/sync/publication-source.service';
import type { ChannelVariant } from './sales.types';
import {
  attributeKind,
  isObject,
  nonNegativeStock,
  text,
} from './variant-normalization';

@Injectable()
export class MercadolibreCurveService {
  constructor(
    private readonly tokens: MercadolibreTokenService,
    private readonly publications: PublicationSourceService,
    private readonly families: FamiliesService,
  ) {}

  async getBySourceKey(
    userId: string,
    sourceKey: string,
  ): Promise<ChannelVariant[]> {
    const family = /^family:([1-9]\d*)$/u.exec(sourceKey);
    if (family) return this.getFamily(userId, family[1]);
    const item = /^item:(MLA\d+)$/u.exec(sourceKey);
    return item ? this.getItem(userId, item[1]) : [];
  }

  async getForSale(
    userId: string,
    itemId: string,
    familyId: string | null,
  ): Promise<ChannelVariant[]> {
    return familyId
      ? this.getFamily(userId, familyId)
      : this.getItem(userId, itemId);
  }

  private async getFamily(
    userId: string,
    familyId: string,
  ): Promise<ChannelVariant[]> {
    const { items } = await this.families.getFamilyItems(userId, familyId);
    return items.map((item) => mapItemOffer(item, familyId));
  }

  private async getItem(
    userId: string,
    itemId: string,
  ): Promise<ChannelVariant[]> {
    const token = await this.tokens.getValidAccessToken(userId);
    const item = (await this.publications.getItemWithAllAttributes(
      itemId,
      token,
    )) as MlItem;
    return mapClassicItem(item);
  }
}

export function mapClassicItem(item: MlItem): ChannelVariant[] {
  const variations = Array.isArray(item.variations)
    ? item.variations.filter(isObject)
    : [];
  if (variations.length === 0) return [mapItemOffer(item, familyIdOf(item))];

  return variations.map((variation) => {
    const attributes = parseAttributes(variation.attribute_combinations);
    return {
      sku:
        findSku(variation.attributes) ??
        text(variation.seller_custom_field) ??
        findSku(item.attributes) ??
        text(item.seller_custom_field),
      ...colorAndSize(attributes),
      ml: {
        itemId: item.id,
        variationId: text(variation.id),
        userProductId:
          text(variation.user_product_id) ?? item.user_product_id ?? null,
        familyId: familyIdOf(item),
        stock: nonNegativeStock(variation.available_quantity),
      },
      tiendaNube: null,
    };
  });
}

export function mapItemOffer(
  item: MlItem,
  familyId: string | null,
): ChannelVariant {
  return {
    sku: findSku(item.attributes) ?? text(item.seller_custom_field),
    ...colorAndSize(parseAttributes(item.attributes)),
    ml: {
      itemId: item.id,
      variationId: null,
      userProductId: item.user_product_id ?? null,
      familyId,
      stock: nonNegativeStock(item.available_quantity),
    },
    tiendaNube: null,
  };
}

function familyIdOf(item: MlItem): string | null {
  return text(item.family_id);
}

function parseAttributes(value: unknown): MlAttribute[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is MlAttribute =>
          isObject(entry) && typeof entry.id === 'string',
      )
    : [];
}

function findSku(value: unknown): string | null {
  return (
    parseAttributes(value).flatMap((attribute) =>
      attribute.id === 'SELLER_SKU' || attribute.id === 'SKU'
        ? (text(attribute.value_name) ?? [])
        : [],
    )[0] ?? null
  );
}

function colorAndSize(attributes: MlAttribute[]): {
  color: string | null;
  size: string | null;
} {
  let color: string | null = null;
  let size: string | null = null;
  for (const attribute of attributes) {
    const kind = attributeKind(attribute.id, text(attribute.name));
    const value =
      text(attribute.value_name) ?? text(attribute.values?.[0]?.name);
    if (kind === 'color' && value) color = value;
    if (kind === 'size' && value) size = value;
  }
  return { color, size };
}
