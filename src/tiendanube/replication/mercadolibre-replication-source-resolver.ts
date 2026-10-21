import { Injectable } from '@nestjs/common';

import { MercadoLibreToTiendanubeMapper } from './mercadolibre-to-tiendanube.mapper';
import { MercadoLibreReplicationNormalizerService } from './mercadolibre-replication-normalizer.service';
import type { MercadolibreApiRequestOptions } from '../../mercadolibre/shared/mercadolibre-api.service';
import type { TiendanubeCreateProductDto } from './tiendanube-replication.types';

type SourceResult = Readonly<{
  sourceKey: string;
  product: TiendanubeCreateProductDto;
  skus: readonly string[];
}>;

@Injectable()
export class MercadoLibreReplicationSourceResolver {
  constructor(
    private readonly normalizer: MercadoLibreReplicationNormalizerService,
  ) {}

  async resolve(
    sourceKey: string,
    sellerId: number,
    accessToken: string,
    options?: MercadolibreApiRequestOptions,
  ): Promise<SourceResult> {
    const normalized = await this.normalizer.normalize(
      sourceKey,
      sellerId,
      accessToken,
      options,
    );
    return {
      sourceKey,
      product: MercadoLibreToTiendanubeMapper.map(normalized),
      skus: [
        ...new Set(
          normalized.variants.flatMap((variant) =>
            variant.sku?.trim() ? [variant.sku.trim()] : [],
          ),
        ),
      ],
    };
  }
}
