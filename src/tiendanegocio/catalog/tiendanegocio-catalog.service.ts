import { Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import { TiendanubeMigrationDiscoveryService } from '../../tiendanube/migration/tiendanube-migration-discovery.service';

/** Exploración paginada, limitada al seller autenticado. Sin escrituras. */
@Injectable()
export class TiendaNegocioCatalogService {
  constructor(
    private readonly mlToken: MercadolibreTokenService,
    private readonly discovery: TiendanubeMigrationDiscoveryService,
  ) {}

  async getPage(userId: string, cursor: string | null) {
    const connection = await this.mlToken.getStoredConnection(userId);
    const accessToken = await this.mlToken.getValidAccessToken(userId, connection);
    const page = await this.discovery.discoverPage({
      sellerId: connection.seller_id,
      accessToken,
      scrollId: cursor,
    });
    return {
      products: page.items.map((item) => ({
        sourceKey: item.sourceKey,
        title: item.title,
        mlaIds: item.mlaIds,
        familyId: item.familyId,
        mlauIds: item.mlauIds,
      })),
      nextCursor: page.nextScrollId,
      finished: page.finished,
    };
  }
}
