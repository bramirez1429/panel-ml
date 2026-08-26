import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DescriptionService } from '../../mercadolibre/direct-publications/description/description.service';
import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import { PublicationSourceService } from '../../mercadolibre/publications/sync/publication-source.service';
import { UserProductFamilyService } from '../../mercadolibre/user-products/user-product-family.service';
import type { ReplicableProduct } from './tiendanube-replication.types';
import { normalizeFamilyProduct } from './mercadolibre-family-normalizer';
import { normalizeLegacyProduct } from './mercadolibre-legacy-normalizer';

@Injectable()
export class MercadoLibreReplicationNormalizerService {
  constructor(
    private readonly publicationSource: PublicationSourceService,
    private readonly familyService: UserProductFamilyService,
    private readonly descriptionService: DescriptionService,
  ) {}

  async normalize(
    sourceKey: string,
    sellerId: number,
    accessToken: string,
  ): Promise<ReplicableProduct> {
    const itemMatch = /^item:(MLA\d+)$/u.exec(sourceKey);
    if (itemMatch)
      return this.normalizeItem(itemMatch[1], sellerId, accessToken);

    const familyMatch = /^family:([1-9]\d*)$/u.exec(sourceKey);
    if (familyMatch)
      return this.normalizeFamily(familyMatch[1], sellerId, accessToken);

    throw new NotFoundException('sourceKey de Mercado Libre inválido');
  }

  private async normalizeItem(
    itemId: string,
    sellerId: number,
    accessToken: string,
  ): Promise<ReplicableProduct> {
    const item = await this.publicationSource.getItemWithAllAttributes(
      itemId,
      accessToken,
    );
    this.assertSeller(item, sellerId);
    const description = await this.descriptionService.getPlainTextByItemId(
      itemId,
      accessToken,
    );
    return normalizeLegacyProduct(item, description);
  }

  private async normalizeFamily(
    familyId: string,
    sellerId: number,
    accessToken: string,
  ): Promise<ReplicableProduct> {
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
      itemIds.map((itemId) =>
        this.publicationSource.getItemWithAllAttributes(itemId, accessToken),
      ),
    );
    for (const item of items) this.assertSeller(item, sellerId);

    const [descriptions, userProducts] = await Promise.all([
      Promise.all(
        items.map((item) =>
          this.descriptionService.getPlainTextByItemId(
            requireItemId(item.id),
            accessToken,
          ),
        ),
      ),
      Promise.all(
        family.userProductIds.map((userProductId) =>
          this.familyService.getUserProduct(userProductId, accessToken, cache),
        ),
      ),
    ]);

    return normalizeFamilyProduct({
      userProductIds: family.userProductIds,
      userProducts,
      offers: items.map((item, index) => ({
        item,
        description: descriptions[index],
      })),
    });
  }

  private assertSeller(item: MercadoLibrePublication, sellerId: number): void {
    if (item.seller_id !== sellerId)
      throw new ForbiddenException(
        'La publicación no pertenece al seller conectado',
      );
  }
}

function requireItemId(value: unknown): string {
  if (typeof value !== 'string' || !/^MLA\d+$/u.test(value))
    throw new NotFoundException('MLA de Mercado Libre inválido');
  return value;
}
