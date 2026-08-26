import { ForbiddenException, Injectable } from '@nestjs/common';

import type { MercadolibreProductDetail } from '../../database/repositories/mercadolibre-publications.types';
import { MercadoLibreReplicationNormalizerService } from './mercadolibre-replication-normalizer.service';
import type { ReplicableProduct } from './tiendanube-replication.types';

/**
 * Adaptador del endpoint histórico por UUID. El registro persistido sólo aporta
 * la identidad; título, variantes, precios, stock, atributos e imágenes se leen
 * nuevamente desde Mercado Libre mediante el normalizador común.
 */
@Injectable()
export class MercadoLibreReplicationSourceService {
  constructor(
    private readonly normalizer: MercadoLibreReplicationNormalizerService,
  ) {}

  async load(
    product: MercadolibreProductDetail,
    sellerId: number,
    accessToken: string,
  ): Promise<ReplicableProduct> {
    if (product.seller_id !== sellerId)
      throw new ForbiddenException(
        'La publicación no pertenece al seller conectado',
      );
    return this.normalizer.normalize(
      product.external_key,
      sellerId,
      accessToken,
    );
  }
}
