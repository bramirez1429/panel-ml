import { Injectable } from '@nestjs/common';
import { TiendanubeConnectionRepository } from '../tiendanube/connections/tiendanube-connection.repository';
import { TiendanubeProductLinkRepository } from '../tiendanube/replication/tiendanube-product-link.repository';
import { MercadolibreCurveService } from './mercadolibre-curve.service';
import type {
  ChannelVariant,
  DetailedVariant,
  RecentSale,
  SaveVariantChannelLink,
  VariantChannelLink,
} from './sales.types';
import {
  LOW_STOCK_MAX,
  OUT_OF_STOCK_MAX,
  SALES_CURVE_CACHE_TTL_MS,
} from './sales.types';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { normalizeColor, normalizeSize } from './variant-normalization';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

type CacheEntry = Readonly<{
  expiresAt: number;
  value: Promise<DetailedVariant[]>;
}>;

@Injectable()
export class SalesCurveService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly mlCurve: MercadolibreCurveService,
    private readonly tnCurve: TiendanubeCurveService,
    private readonly tnConnections: TiendanubeConnectionRepository,
    private readonly productLinks: TiendanubeProductLinkRepository,
    private readonly variantLinks: VariantChannelLinksRepository,
  ) {}

  getForSale(userId: string, sale: RecentSale): Promise<DetailedVariant[]> {
    const cacheKey = [
      userId,
      sale.familyId ? `family:${sale.familyId}` : sale.mlItemId,
      sale.tnProductId,
    ].join('|');
    const current = this.cache.get(cacheKey);
    if (current && current.expiresAt > Date.now()) return current.value;

    const value = this.load(userId, sale).catch((error: unknown) => {
      this.cache.delete(cacheKey);
      throw error;
    });
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + SALES_CURVE_CACHE_TTL_MS,
      value,
    });
    return value;
  }

  invalidate(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}|`)) this.cache.delete(key);
    }
  }

  private async load(
    userId: string,
    sale: RecentSale,
  ): Promise<DetailedVariant[]> {
    const [connectionResult, linksResult] = await Promise.allSettled([
      this.tnConnections.findCredentialsByUserId(userId),
      this.variantLinks.findByUserId(userId),
    ]);
    const connection =
      connectionResult.status === 'fulfilled' ? connectionResult.value : null;
    const links = linksResult.status === 'fulfilled' ? linksResult.value : [];
    let sourceKey = sale.familyId
      ? `family:${sale.familyId}`
      : sale.mlItemId
        ? `item:${sale.mlItemId}`
        : null;
    let tnProductId = sale.tnProductId;

    if (sourceKey && !tnProductId) {
      tnProductId = uniqueTnProductId(links, sale);
    }
    if (tnProductId && !sourceKey) {
      sourceKey = uniqueMlSourceKey(links, tnProductId);
    }

    if (connection && sourceKey && !tnProductId) {
      const productLink = await Promise.allSettled([
        this.productLinks.findBySourceKey({
          userId,
          storeId: connection.storeId,
          sourceKey,
        }),
      ]);
      tnProductId =
        productLink[0].status === 'fulfilled'
          ? (productLink[0].value?.tiendanubeProductId ?? null)
          : null;
    }
    if (connection && tnProductId && !sourceKey) {
      const sourceResult = await Promise.allSettled([
        this.productLinks.findSourceKeyByTiendanubeProductId({
          userId,
          storeId: connection.storeId,
          tiendanubeProductId: tnProductId,
        }),
      ]);
      sourceKey =
        sourceResult[0].status === 'fulfilled' ? sourceResult[0].value : null;
    }

    const [mlResult, tnResult] = await Promise.allSettled([
      sourceKey
        ? this.mlCurve.getBySourceKey(userId, sourceKey)
        : Promise.resolve([]),
      tnProductId
        ? this.tnCurve.getForUser(userId, tnProductId)
        : Promise.resolve([]),
    ]);
    const ml = mlResult.status === 'fulfilled' ? mlResult.value : [];
    const tn = tnResult.status === 'fulfilled' ? tnResult.value : [];
    return this.match(userId, ml, tn, links);
  }

  private async match(
    userId: string,
    mlVariants: ChannelVariant[],
    tnVariants: ChannelVariant[],
    links: VariantChannelLink[],
  ): Promise<DetailedVariant[]> {
    const usedTn = new Set<string>();
    const autoLinks: SaveVariantChannelLink[] = [];
    const result = mlVariants.map((mlVariant) => {
      const persisted = links.find((link) => sameMl(link, mlVariant));
      if (persisted) {
        const linked = tnVariants.find((tn) => sameTn(persisted, tn));
        if (linked) {
          usedTn.add(tnKey(linked));
          return detail(mlVariant, linked, 'LINKED');
        }
      }

      const available = tnVariants.filter((tn) => !usedTn.has(tnKey(tn)));
      const skuMatches = mlVariant.sku
        ? available.filter((tn) => tn.sku === mlVariant.sku)
        : [];
      const attributeMatches =
        skuMatches.length === 0 ? matchByAttributes(mlVariant, available) : [];
      const candidates = skuMatches.length > 0 ? skuMatches : attributeMatches;
      if (candidates.length !== 1) {
        return detail(
          mlVariant,
          null,
          candidates.length > 1 ? 'AMBIGUOUS' : 'UNLINKED',
        );
      }

      const linked = candidates[0];
      usedTn.add(tnKey(linked));
      const automatic = toAutoLink(
        userId,
        mlVariant,
        linked,
        skuMatches.length === 1 ? 'SKU' : 'ATTRIBUTES',
      );
      if (automatic) autoLinks.push(automatic);
      return detail(mlVariant, linked, 'AUTO_LINKED');
    });

    result.push(
      ...tnVariants
        .filter((tn) => !usedTn.has(tnKey(tn)))
        .map((tn) => detail(null, tn, 'UNLINKED')),
    );
    await Promise.allSettled(
      autoLinks.map((link) => this.variantLinks.save(link)),
    );
    return result;
  }
}

function uniqueTnProductId(
  links: VariantChannelLink[],
  sale: RecentSale,
): string | null {
  const exact = links.find(
    (link) =>
      link.mlItemId === sale.mlItemId &&
      link.mlVariationId === sale.mlVariationId,
  );
  if (exact) return exact.tnProductId;
  const ids = new Set(
    links
      .filter((link) =>
        sale.familyId
          ? link.familyId === sale.familyId
          : link.mlItemId === sale.mlItemId,
      )
      .map((link) => link.tnProductId),
  );
  return ids.size === 1 ? [...ids][0] : null;
}

function uniqueMlSourceKey(
  links: VariantChannelLink[],
  tnProductId: string,
): string | null {
  const keys = new Set(
    links
      .filter((link) => link.tnProductId === tnProductId)
      .map((link) =>
        link.familyId ? `family:${link.familyId}` : `item:${link.mlItemId}`,
      ),
  );
  return keys.size === 1 ? [...keys][0] : null;
}

function matchByAttributes(
  ml: ChannelVariant,
  candidates: ChannelVariant[],
): ChannelVariant[] {
  const color = normalizeColor(ml.color);
  const size = normalizeSize(ml.size);
  if (!color && !size) return [];
  return candidates.filter(
    (candidate) =>
      normalizeColor(candidate.color) === color &&
      normalizeSize(candidate.size) === size,
  );
}

function sameMl(link: VariantChannelLink, variant: ChannelVariant): boolean {
  return Boolean(
    variant.ml &&
    link.mlItemId === variant.ml.itemId &&
    link.mlVariationId === variant.ml.variationId,
  );
}

function sameTn(link: VariantChannelLink, variant: ChannelVariant): boolean {
  return Boolean(
    variant.tiendaNube &&
    link.tnProductId === variant.tiendaNube.productId &&
    link.tnVariantId === variant.tiendaNube.variantId,
  );
}

function tnKey(variant: ChannelVariant): string {
  return variant.tiendaNube
    ? `${variant.tiendaNube.productId}:${variant.tiendaNube.variantId}`
    : '';
}

function toAutoLink(
  userId: string,
  ml: ChannelVariant,
  tn: ChannelVariant,
  source: 'SKU' | 'ATTRIBUTES',
): SaveVariantChannelLink | null {
  if (!ml.ml || !tn.tiendaNube) return null;
  return {
    userId,
    mlItemId: ml.ml.itemId,
    mlVariationId: ml.ml.variationId,
    userProductId: ml.ml.userProductId,
    familyId: ml.ml.familyId,
    tnProductId: tn.tiendaNube.productId,
    tnVariantId: tn.tiendaNube.variantId,
    sku: ml.sku ?? tn.sku,
    normalizedColor: normalizeColor(ml.color ?? tn.color),
    normalizedSize: normalizeSize(ml.size ?? tn.size),
    matchSource: source,
  };
}

function detail(
  ml: ChannelVariant | null,
  tn: ChannelVariant | null,
  mappingStatus: DetailedVariant['mappingStatus'],
): DetailedVariant {
  const mlStock = ml?.ml?.stock ?? null;
  const tnStock = tn?.tiendaNube?.stock ?? null;
  const stockDifference =
    mlStock === null || tnStock === null ? null : mlStock - tnStock;
  const knownStocks = [mlStock, tnStock].filter(
    (stock): stock is number => stock !== null,
  );
  const minimum = knownStocks.length > 0 ? Math.min(...knownStocks) : null;
  return {
    sku: ml?.sku ?? tn?.sku ?? null,
    color: ml?.color ?? tn?.color ?? null,
    size: ml?.size ?? tn?.size ?? null,
    ml: ml?.ml ?? null,
    tiendaNube: tn?.tiendaNube ?? null,
    difference: stockDifference,
    stockDifference,
    hasStockDifference: stockDifference === null ? null : stockDifference !== 0,
    mappingStatus,
    stockStatus:
      minimum === null
        ? null
        : minimum <= OUT_OF_STOCK_MAX
          ? 'OUT_OF_STOCK'
          : minimum <= LOW_STOCK_MAX
            ? 'LOW'
            : 'OK',
  };
}
