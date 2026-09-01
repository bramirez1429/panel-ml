import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { MercadoLibrePublication } from '../../publications/publication.types';
import { PublicationSourceService } from '../../publications/sync/publication-source.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import type { MercadoLibreUserProduct } from '../../user-products/user-product.types';
import { DescriptionService } from '../description/description.service';
import { SimilarPublicationDraftMapper } from './similar-publication.mapper';
import type {
  SimilarPublicationDraft,
  SimilarPublicationSourceContext,
  SimilarPublicationSourceType,
} from './similar-publication.types';

@Injectable()
export class SimilarPublicationSourceService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly publicationSource: PublicationSourceService,
    private readonly familyService: UserProductFamilyService,
    private readonly descriptionService: DescriptionService,
    private readonly apiService: MercadolibreApiService,
    private readonly mapper: SimilarPublicationDraftMapper,
  ) {}

  async getDraft(
    userId: string,
    sourceKey: string,
  ): Promise<SimilarPublicationDraft> {
    return (await this.load(userId, sourceKey)).draft;
  }

  async load(
    userId: string,
    sourceKey: string,
  ): Promise<SimilarPublicationSourceContext> {
    const normalizedSourceKey = normalizeSourceKey(sourceKey);
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const source = normalizedSourceKey.startsWith('item:')
      ? await this.loadItem(
          normalizedSourceKey,
          connection.seller_id,
          accessToken,
        )
      : await this.loadFamily(
          normalizedSourceKey,
          connection.seller_id,
          accessToken,
        );
    this.assertNotCatalog(source.items);
    const description = await this.descriptionService.getPlainTextByItemId(
      requireItemId(source.items[0]),
      accessToken,
    );
    const draft = this.mapper.map({
      sourceKey: normalizedSourceKey,
      sourceType: source.sourceType,
      items: source.items,
      userProducts: source.userProducts,
      description,
    });
    return {
      sellerId: connection.seller_id,
      accessToken,
      draft,
      originalIdentifierValues: this.mapper.originalIdentifierValues(
        source.items,
        source.userProducts,
      ),
      originalPictureIds: new Set(
        [
          ...source.items.map((item) => item.pictures),
          ...source.userProducts.map((userProduct) => userProduct.pictures),
        ].flatMap(parsePictureIds),
      ),
    };
  }

  async sellerUsesUserProducts(
    sellerId: number,
    accessToken: string,
  ): Promise<boolean> {
    const data = await this.apiService.get<unknown>(
      `/users/${sellerId}`,
      accessToken,
    );
    if (
      !isJsonObject(data) ||
      data.id !== sellerId ||
      !Array.isArray(data.tags)
    ) {
      throw new ConflictException('Mercado Libre devolvió un seller inválido');
    }
    return data.tags.includes('user_product_seller');
  }

  private async loadItem(
    sourceKey: string,
    sellerId: number,
    accessToken: string,
  ): Promise<LoadedSource> {
    const itemId = sourceKey.slice('item:'.length);
    const item = await this.publicationSource.getItemWithAllAttributes(
      itemId,
      accessToken,
    );
    this.assertSeller(item, sellerId);
    const userProductId = text(item.user_product_id);
    if (!text(item.family_name) || !userProductId) {
      return { sourceType: 'LEGACY', items: [item], userProducts: [] };
    }
    const cache = this.familyService.createCache();
    const userProduct = await this.familyService.getUserProduct(
      userProductId,
      accessToken,
      cache,
    );
    return {
      sourceType: 'USER_PRODUCT',
      items: [item],
      userProducts: [userProduct],
    };
  }

  private async loadFamily(
    sourceKey: string,
    sellerId: number,
    accessToken: string,
  ): Promise<LoadedSource> {
    const familyId = sourceKey.slice('family:'.length);
    const cache = this.familyService.createCache();
    const family = await this.familyService.getFamily(
      familyId,
      accessToken,
      cache,
    );
    if (family.userId !== sellerId) {
      throw new ForbiddenException(
        'La familia no pertenece al seller conectado',
      );
    }
    const itemIds = await this.publicationSource.getItemIdsForUserProducts(
      sellerId,
      family.userProductIds,
      accessToken,
    );
    const items: MercadoLibrePublication[] = [];
    for (const itemId of itemIds) {
      const item = await this.publicationSource.getItemWithAllAttributes(
        itemId,
        accessToken,
      );
      this.assertSeller(item, sellerId);
      items.push(item);
    }
    if (items.length === 0) {
      throw new ConflictException(
        'La familia no tiene publicaciones reutilizables',
      );
    }
    const userProducts: MercadoLibreUserProduct[] = [];
    for (const userProductId of family.userProductIds) {
      userProducts.push(
        await this.familyService.getUserProduct(
          userProductId,
          accessToken,
          cache,
        ),
      );
    }
    return { sourceType: 'USER_PRODUCT', items, userProducts };
  }

  private assertSeller(item: MercadoLibrePublication, sellerId: number): void {
    const owner = item.seller_id;
    const matches =
      (typeof owner === 'number' || typeof owner === 'string') &&
      String(owner) === String(sellerId);
    if (!matches) {
      throw new ForbiddenException(
        'La publicación no pertenece al seller conectado',
      );
    }
  }

  private assertNotCatalog(items: MercadoLibrePublication[]): void {
    const catalog = items.some(
      (item) =>
        text(item.catalog_product_id) !== null ||
        (Array.isArray(item.tags) && item.tags.includes('catalog_listing')),
    );
    if (catalog) {
      throw new ConflictException({
        errorCode: 'SIMILAR_PUBLICATION_CATALOG_NOT_SUPPORTED',
        message:
          'Esta publicación pertenece a catálogo y no puede usarse para publicar similar de forma segura.',
      });
    }
  }
}

type LoadedSource = {
  sourceType: SimilarPublicationSourceType;
  items: MercadoLibrePublication[];
  userProducts: MercadoLibreUserProduct[];
};

function normalizeSourceKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('sourceKey es obligatorio');
  }
  const normalized = value.trim();
  const item = /^item:(MLA\d+)$/iu.exec(normalized);
  if (item) return `item:${item[1].toUpperCase()}`;
  const family = /^family:([1-9]\d*)$/u.exec(normalized);
  if (family) return `family:${family[1]}`;
  throw new BadRequestException('sourceKey debe ser item:MLA... o family:...');
}

function requireItemId(item: MercadoLibrePublication | undefined): string {
  if (!item || typeof item.id !== 'string' || !/^MLA\d+$/u.test(item.id)) {
    throw new ConflictException('Mercado Libre devolvió un MLA inválido');
  }
  return item.id;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePictureIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((picture: unknown) => {
    if (!isJsonObject(picture)) return [];
    const id = text(picture.id);
    return id ? [id] : [];
  });
}
