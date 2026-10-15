import { BadGatewayException, Injectable } from '@nestjs/common';

import { PublicationSourceService } from '../../mercadolibre/publications/sync/publication-source.service';
import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import { UserProductFamilyService } from '../../mercadolibre/user-products/user-product-family.service';
import type { UserProductFamilyCache } from '../../mercadolibre/user-products/user-product.types';
import type { DiscoveredTiendanubeMigrationItem } from './tiendanube-migration.types';

@Injectable()
export class TiendanubeMigrationDiscoveryService {
  constructor(
    private readonly publicationSource: PublicationSourceService,
    private readonly familyService: UserProductFamilyService,
  ) {}

  async discoverPage(input: {
    sellerId: number;
    accessToken: string;
    scrollId: string | null;
    maxProducts?: number;
  }): Promise<{
    items: readonly DiscoveredTiendanubeMigrationItem[];
    nextScrollId: string | null;
    finished: boolean;
  }> {
    const page = await this.publicationSource.fetchNextScanPage(
      input.sellerId,
      input.accessToken,
      input.scrollId ?? undefined,
    );
    if (page.itemIds.length === 0) {
      return { items: [], nextScrollId: null, finished: true };
    }
    const source = await this.publicationSource.getPublicationDetails(
      page.itemIds,
      input.accessToken,
      input.sellerId,
    );
    if (source.errors.length > 0) {
      throw new BadGatewayException(
        'No se pudieron leer todas las publicaciones de Mercado Libre',
      );
    }
    const items = new Map<string, DiscoveredTiendanubeMigrationItem>();
    const familyCache = this.familyService.createCache();
    for (const publication of source.publications) {
      const item = await this.groupPublication(
        publication,
        input.sellerId,
        input.accessToken,
        familyCache,
      );
      const previous = items.get(item.sourceKey);
      items.set(
        item.sourceKey,
        previous ? mergeDiscoveredItem(previous, item) : item,
      );
    }
    return {
      items: [...items.values()].slice(0, input.maxProducts),
      nextScrollId: page.scrollId,
      finished: page.scrollId === null,
    };
  }

  private async groupPublication(
    publication: MercadoLibrePublication,
    sellerId: number,
    accessToken: string,
    familyCache: UserProductFamilyCache,
  ): Promise<DiscoveredTiendanubeMigrationItem> {
    const mlaId = requireMlaId(publication.id);
    const title = textOrNull(publication.title);
    const mlauId = parseMlauId(publication.user_product_id);
    if (!mlauId) {
      return {
        sourceKey: `item:${mlaId}`,
        title,
        mlaIds: [mlaId],
        familyId: null,
        mlauIds: [],
      };
    }
    const family = await this.familyService.resolveFamily(
      mlauId,
      accessToken,
      familyCache,
    );
    if (family.userId !== sellerId) {
      throw new BadGatewayException(
        'La familia descubierta pertenece a otro seller',
      );
    }
    return {
      sourceKey: `family:${family.familyId}`,
      title,
      mlaIds: [mlaId],
      familyId: family.familyId,
      mlauIds: family.userProductIds,
    };
  }
}

function requireMlaId(value: unknown): string {
  if (typeof value !== 'string' || !/^MLA\d+$/u.test(value)) {
    throw new BadGatewayException('Mercado Libre devolvió un MLA inválido');
  }
  return value;
}

function parseMlauId(value: unknown): string | null {
  return typeof value === 'string' && /^MLAU\d+$/u.test(value.trim())
    ? value.trim()
    : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : null;
}

function mergeDiscoveredItem(
  left: DiscoveredTiendanubeMigrationItem,
  right: DiscoveredTiendanubeMigrationItem,
): DiscoveredTiendanubeMigrationItem {
  return {
    ...left,
    title: left.title ?? right.title,
    mlaIds: [...new Set([...left.mlaIds, ...right.mlaIds])],
    mlauIds: [...new Set([...left.mlauIds, ...right.mlauIds])],
  };
}
