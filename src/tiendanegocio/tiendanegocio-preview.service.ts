import { BadRequestException, Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../mercadolibre/auth/mercadolibre-token.service';
import { MercadoLibreReplicationNormalizerService } from '../tiendanube/replication/mercadolibre-replication-normalizer.service';
import { mapMercadoLibreToTiendaNegocio } from './tiendanegocio-product.mapper';

@Injectable()
export class TiendaNegocioPreviewService {
  constructor(
    private readonly tokens: MercadolibreTokenService,
    private readonly normalizer: MercadoLibreReplicationNormalizerService,
  ) {}

  async preview(userId: string, sourceKey: string) {
    if (!/^(item:MLA\d+|family:[1-9]\d*)$/.test(sourceKey ?? ''))
      throw new BadRequestException('sourceKey inválido');
    return this.tokens.executeWithValidAccessToken(userId, async ({ connection, accessToken }) => {
      const source = await this.normalizer.normalize(sourceKey, connection.seller_id, accessToken);
      return { sourceKey, ...mapMercadoLibreToTiendaNegocio(source) };
    });
  }
}
