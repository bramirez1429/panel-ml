import { Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import { MercadoLibreReplicationNormalizerService } from '../../tiendanube/replication/mercadolibre-replication-normalizer.service';
import { MercadoLibreToTiendaNegocioMapper } from './mercadolibre-to-tiendanegocio.mapper';

@Injectable()
export class TiendaNegocioPreviewService {
  constructor(
    private readonly mlToken: MercadolibreTokenService,
    private readonly normalizer: MercadoLibreReplicationNormalizerService,
  ) {}

  /** Genera el payload real sin publicar ni modificar productos. */
  async preview(userId: string, sourceKey: string) {
    const connection = await this.mlToken.getStoredConnection(userId);
    const accessToken = await this.mlToken.getValidAccessToken(userId, connection);
    const source = await this.normalizer.normalize(
      sourceKey,
      connection.seller_id,
      accessToken,
    );
    const payload = MercadoLibreToTiendaNegocioMapper.map(source);
    return {
      sourceKey,
      name: payload.name.es,
      variantCount: source.variants.length,
      imageCount: source.images.length,
      totalStock: source.variants.reduce((sum, item) => sum + item.stock, 0),
      prices: source.variants.map((variant) => variant.price),
      attributes: source.attributes.map((item) => item.name),
      publicationStatus: 'DRAFT',
      readyToMigrate: false,
      note: 'Vista previa de solo lectura. Falta validar la conexión y los jobs de migración.',
    };
  }
}
