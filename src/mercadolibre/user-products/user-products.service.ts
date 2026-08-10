import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  MercadolibreApiService,
  sanitizeMercadoLibreData,
} from '../shared/mercadolibre-api.service';
import { isJsonObject, isNonEmptyString } from '../shared/mercadolibre.types';
import { MercadoLibreUserProduct } from './user-product.types';

@Injectable()
export class UserProductsService {
  /** Prepara el acceso compartido a Mercado Libre. */
  constructor(private readonly apiService: MercadolibreApiService) {}

  /** Consulta y valida un User Product. */
  async getUserProduct(
    userProductId: string,
    accessToken: string,
  ): Promise<MercadoLibreUserProduct> {
    const id = normalizeUserProductId(userProductId);
    if (!id) throw new BadGatewayException('User Product inválido');

    const data = await this.apiService.get<unknown>(
      `/user-products/${encodeURIComponent(id)}`,
      accessToken,
    );
    if (!isJsonObject(data) || data.id !== id) {
      throw new BadGatewayException('Respuesta de User Product inválida');
    }
    return sanitizeMercadoLibreData({ ...data, id });
  }
}

/** Normaliza un identificador MLAU. */
function normalizeUserProductId(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const id = value.trim();
  return /^MLAU\d+$/.test(id) ? id : null;
}
