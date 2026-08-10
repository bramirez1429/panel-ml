import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  MercadoLibrePublication,
  NormalizationContext,
  NormalizedPublicationBundle,
  ReducedAttribute,
  ResolvedVariantPublication,
} from '../publication.types';
import { PublicationModelDetectorService } from './publication-model-detector.service';
import {
  aggregateStatus,
  buildVariantLabel,
  dateOrNull,
  firstTextValue,
  latestSourceDate,
  numberOrNull,
  priceRange,
  quantityOrZero,
  reduceAttributes,
  reduceSharedVariations,
  selectRepresentative,
  textOrNull,
  varyingAttributeIds,
} from './publication-normalizer.helpers';

@Injectable()
export class PublicationNormalizerService {
  /** Recibe el detector puro del modelo de publicación. */
  constructor(private readonly detector: PublicationModelDetectorService) {}

  /** Normaliza una publicación con condiciones compartidas. */
  normalizeShared(
    publication: MercadoLibrePublication,
    context: NormalizationContext,
  ): NormalizedPublicationBundle {
    this.validateContext(context);
    if (this.detector.detect(publication) !== 'SHARED') {
      throw new BadGatewayException('La publicación no usa el modelo SHARED');
    }

    const itemId = this.requireItemId(publication);
    const title = textOrNull(publication.title) ?? itemId;
    const variations = reduceSharedVariations(publication.variations, title);
    const price = numberOrNull(publication.price);
    const syncedAt = dateOrNull(context.syncedAt) as string;

    return {
      parent: {
        seller_id: context.sellerId,
        external_key: `item:${itemId}`,
        model: 'SHARED',
        family_id: null,
        parent_item_id: itemId,
        family_name: null,
        title,
        thumbnail: textOrNull(publication.thumbnail),
        status: textOrNull(publication.status),
        category_id: textOrNull(publication.category_id),
        currency_id: textOrNull(publication.currency_id),
        price_from: price,
        price_to: price,
        stock_total: variations.length
          ? variations.reduce(
              (total, variation) => total + variation.availableQuantity,
              0,
            )
          : quantityOrZero(publication.available_quantity),
        children_count: 0,
        permalink: textOrNull(publication.permalink),
        shared_variations: variations,
        source_updated_at: dateOrNull(publication.last_updated),
        last_synced_at: syncedAt,
      },
      children: [],
    };
  }

  /** Normaliza una familia y todos sus MLA independientes. */
  normalizeVariantFamily(
    resolvedPublications: ResolvedVariantPublication[],
    context: NormalizationContext,
  ): NormalizedPublicationBundle {
    this.validateContext(context);
    const sources = this.validateVariantFamily(resolvedPublications);
    const representative = selectRepresentative(sources);
    const publications = sources.map(({ publication }) => publication);
    const familyId = representative.familyId.trim();
    const attributes = sources.map(({ publication }) =>
      reduceAttributes(publication.attributes),
    );
    const varyingIds = varyingAttributeIds(attributes);
    const children = sources.map((source, index) =>
      this.buildChild(source, attributes[index], varyingIds, context),
    );
    const range = priceRange(publications);
    const familyName = textOrNull(representative.publication.family_name);
    const syncedAt = dateOrNull(context.syncedAt) as string;

    return {
      parent: {
        seller_id: context.sellerId,
        external_key: `family:${familyId}`,
        model: 'VARIANT_PRICING',
        family_id: familyId,
        parent_item_id: null,
        family_name: familyName,
        title:
          familyName ?? textOrNull(representative.userProductName) ?? familyId,
        thumbnail: firstTextValue(publications, 'thumbnail'),
        status: aggregateStatus(publications),
        category_id: textOrNull(representative.publication.category_id),
        currency_id: textOrNull(representative.publication.currency_id),
        price_from: range.minimum,
        price_to: range.maximum,
        stock_total: children.reduce(
          (total, child) => total + (child.available_quantity ?? 0),
          0,
        ),
        children_count: children.length,
        permalink: textOrNull(representative.publication.permalink),
        shared_variations: [],
        source_updated_at: latestSourceDate(publications),
        last_synced_at: syncedAt,
      },
      children,
    };
  }

  /** Construye un child sin product_id, que se asigna al persistir. */
  private buildChild(
    source: ResolvedVariantPublication,
    attributes: ReducedAttribute[],
    varyingIds: string[],
    context: NormalizationContext,
  ): NormalizedPublicationBundle['children'][number] {
    const itemId = this.requireItemId(source.publication);
    const title = textOrNull(source.publication.title);
    const userProductId = source.userProductId.trim();
    const syncedAt = dateOrNull(context.syncedAt) as string;
    return {
      item_id: itemId,
      user_product_id: userProductId,
      variant_label: buildVariantLabel(
        attributes,
        varyingIds,
        title,
        userProductId,
      ),
      title: title ?? textOrNull(source.userProductName),
      thumbnail: textOrNull(source.publication.thumbnail),
      status: textOrNull(source.publication.status),
      currency_id: textOrNull(source.publication.currency_id),
      listing_type_id: textOrNull(source.publication.listing_type_id),
      price: numberOrNull(source.publication.price),
      available_quantity: quantityOrZero(source.publication.available_quantity),
      sold_quantity: quantityOrZero(source.publication.sold_quantity),
      attributes,
      permalink: textOrNull(source.publication.permalink),
      source_updated_at: dateOrNull(source.publication.last_updated),
      last_synced_at: syncedAt,
    };
  }

  /** Valida y ordena una familia resuelta. */
  private validateVariantFamily(
    sources: ResolvedVariantPublication[],
  ): ResolvedVariantPublication[] {
    if (sources.length === 0) {
      throw new BadGatewayException('La familia no tiene publicaciones');
    }
    const familyIds = new Set<string>();
    const itemIds = new Set<string>();

    for (const source of sources) {
      if (this.detector.detect(source.publication) !== 'VARIANT_PRICING') {
        throw new BadGatewayException('La familia contiene un MLA SHARED');
      }
      const familyId = textOrNull(source.familyId);
      const userProductId = textOrNull(source.userProductId);
      const itemId = this.requireItemId(source.publication);
      if (!familyId || !userProductId || !/^MLAU\d+$/.test(userProductId)) {
        throw new BadGatewayException('Relación de User Product inválida');
      }
      familyIds.add(familyId);
      itemIds.add(itemId);
    }
    if (familyIds.size !== 1 || itemIds.size !== sources.length) {
      throw new BadGatewayException(
        'Familia inconsistente o con MLA repetidos',
      );
    }
    return [...sources].sort((left, right) =>
      this.requireItemId(left.publication).localeCompare(
        this.requireItemId(right.publication),
      ),
    );
  }

  /** Valida el contexto común de sincronización. */
  private validateContext(context: NormalizationContext): void {
    if (
      !Number.isSafeInteger(context.sellerId) ||
      context.sellerId <= 0 ||
      !dateOrNull(context.syncedAt)
    ) {
      throw new BadGatewayException('Contexto de normalización inválido');
    }
  }

  /** Devuelve un item ID válido. */
  private requireItemId(publication: MercadoLibrePublication): string {
    const itemId = textOrNull(publication.id);
    if (!itemId || !/^MLA\d+$/.test(itemId)) {
      throw new BadGatewayException('Publicación sin item_id válido');
    }
    return itemId;
  }
}
