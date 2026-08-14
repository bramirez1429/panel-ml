import { BadGatewayException, Injectable } from '@nestjs/common';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { PublishingContext } from './publication-publishing.types';

@Injectable()
export class PublicationPublishingCapabilitiesService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Obtiene siempre el seller conectado y sus capacidades vivas. */
  async getContext(): Promise<PublishingContext> {
    const connection = await this.tokenService.getStoredConnection();
    const accessToken = await this.tokenService.getValidAccessToken(connection);
    const seller = await this.apiService.get<unknown>(
      `/users/${connection.seller_id}`,
      accessToken,
    );
    if (
      !isJsonObject(seller) ||
      seller.id !== connection.seller_id ||
      !Array.isArray(seller.tags) ||
      seller.tags.some((tag) => typeof tag !== 'string')
    ) {
      throw new BadGatewayException(
        'Mercado Libre devolvio un seller invalido',
      );
    }
    return {
      sellerId: connection.seller_id,
      accessToken,
      usesUserProducts: seller.tags.includes('user_product_seller'),
      managesWarehouse: seller.tags.includes('warehouse_management'),
    };
  }
}
