import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import { MercadoLibreReplicationNormalizerService } from './mercadolibre-replication-normalizer.service';

export type TiendanubeReplicationPreview = Readonly<{
  sourceKey: string;
  title: string;
  priceFrom: number | null;
  priceTo: number | null;
  tags: string[];
}>;

@Injectable()
export class TiendanubeReplicationPreviewService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly normalizer: MercadoLibreReplicationNormalizerService,
  ) {}

  async getPreview(userId: string, sourceKey: string): Promise<TiendanubeReplicationPreview> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(userId, connection);
    const product = await this.normalizer.normalize(sourceKey, connection.seller_id, accessToken);
    const prices = product.variants.map(({ price }) => price).filter(Number.isFinite);

    return {
      sourceKey,
      title: product.title,
      priceFrom: prices.length ? Math.min(...prices) : null,
      priceTo: prices.length ? Math.max(...prices) : null,
      tags: [...(product.tags ?? [])],
    };
  }
}
