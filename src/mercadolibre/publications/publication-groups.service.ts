import { BadGatewayException, Injectable } from '@nestjs/common';
import { UserProductsService } from '../user-products/user-products.service';
import { UserProductMetadata } from '../user-products/user-product.types';
import {
  MercadoLibrePublication,
  PublicationChild,
  PublicationModel,
  PublicationRow,
  SharedPublicationRow,
  VariantPricingPublicationRow,
} from './publication.types';

const USER_PRODUCT_LISTING_TAG = 'user_product_listing';

@Injectable()
export class PublicationGroupsService {
  /** Prepara el acceso a la metadata de User Products. */
  constructor(private readonly userProductsService: UserProductsService) {}

  /** Agrupa publicaciones en productos listos para la tabla. */
  async buildPublicationRows(
    publications: MercadoLibrePublication[],
    accessToken: string,
  ): Promise<PublicationRow[]> {
    const metadata = await this.getVariantMetadata(publications, accessToken);
    const rows = new Map<string, PublicationRow>();

    for (const publication of publications) {
      const itemId = textOrNull(publication.id);
      if (!itemId) continue;

      if (this.detectPublicationModel(publication) === 'SHARED') {
        rows.set(`shared:${itemId}`, this.buildSharedRow(publication, itemId));
        continue;
      }
      this.addVariantPricingRow(rows, publication, itemId, metadata);
    }

    return [...rows.values()];
  }

  /** Decide el modelo sin confundir variations legacy con condiciones nuevas. */
  detectPublicationModel(
    publication: MercadoLibrePublication,
  ): PublicationModel {
    const rootId = this.userProductsService.getRootUserProductId(publication);
    if (!rootId) return 'SHARED';

    return this.hasVariantPricingMarker(publication)
      ? 'VARIANT_PRICING'
      : 'SHARED';
  }

  /** Consulta metadata solo para MLAU raíz del modelo nuevo. */
  private async getVariantMetadata(
    publications: MercadoLibrePublication[],
    accessToken: string,
  ): Promise<Map<string, UserProductMetadata>> {
    const ids = publications.flatMap((publication) => {
      if (this.detectPublicationModel(publication) !== 'VARIANT_PRICING') {
        return [];
      }
      const id = this.userProductsService.getRootUserProductId(publication);
      return id ? [id] : [];
    });
    return this.userProductsService.getMetadataMap(ids, accessToken);
  }

  /** Comprueba las señales explícitas del modelo de precio por variante. */
  private hasVariantPricingMarker(
    publication: MercadoLibrePublication,
  ): boolean {
    if (textOrNull(publication.family_name)) return true;
    return (
      Array.isArray(publication.tags) &&
      publication.tags.includes(USER_PRODUCT_LISTING_TAG)
    );
  }

  /** Construye una fila que conserva una única condición compartida. */
  private buildSharedRow(
    publication: MercadoLibrePublication,
    itemId: string,
  ): SharedPublicationRow {
    return {
      type: 'SHARED',
      parent: {
        id: itemId,
        title: textOrNull(publication.title),
        status: textOrNull(publication.status),
        thumbnail: textOrNull(publication.thumbnail),
        price: numberOrNull(publication.price),
      },
      children: [],
    };
  }

  /** Agrega un MLA como hijo único de su familia. */
  private addVariantPricingRow(
    rows: Map<string, PublicationRow>,
    publication: MercadoLibrePublication,
    itemId: string,
    metadata: Map<string, UserProductMetadata>,
  ): void {
    const userProductId =
      this.userProductsService.getRootUserProductId(publication);
    const userProduct = userProductId ? metadata.get(userProductId) : undefined;
    if (!userProduct) {
      throw new BadGatewayException('Falta metadata del User Product');
    }

    const key = `family:${userProduct.familyId}`;
    const existing = rows.get(key);
    const row = this.getOrCreateFamilyRow(existing, publication, userProduct);
    this.addChild(row, publication, itemId, userProduct);
    rows.set(key, row);
  }

  /** Reutiliza una familia existente o crea una nueva. */
  private getOrCreateFamilyRow(
    existing: PublicationRow | undefined,
    publication: MercadoLibrePublication,
    metadata: UserProductMetadata,
  ): VariantPricingPublicationRow {
    if (existing?.type === 'VARIANT_PRICING') return existing;

    return {
      type: 'VARIANT_PRICING',
      parent: {
        familyId: metadata.familyId,
        title: firstText(
          publication.family_name,
          metadata.name,
          publication.title,
        ),
      },
      children: [],
    };
  }

  /** Agrega un solo hijo por MLA y usa su MLAU raíz. */
  private addChild(
    row: VariantPricingPublicationRow,
    publication: MercadoLibrePublication,
    itemId: string,
    metadata: UserProductMetadata,
  ): void {
    if (row.children.some((child) => child.id === itemId)) return;
    row.children.push(this.buildChild(publication, itemId, metadata));
  }

  /** Normaliza un MLA separado como hijo de la familia. */
  private buildChild(
    publication: MercadoLibrePublication,
    itemId: string,
    metadata: UserProductMetadata,
  ): PublicationChild {
    return {
      id: itemId,
      userProductId: metadata.id,
      title: firstText(metadata.name, publication.title),
      status: textOrNull(publication.status),
      price: numberOrNull(publication.price),
    };
  }
}

/** Devuelve texto no vacío o null. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Devuelve un número finito o null. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Devuelve el primer texto válido. */
function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = textOrNull(value);
    if (text) return text;
  }
  return null;
}
