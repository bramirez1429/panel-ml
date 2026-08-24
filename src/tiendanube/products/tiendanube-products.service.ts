import { Injectable, UnauthorizedException } from '@nestjs/common';

import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeProductMapper } from './tiendanube-product.mapper';
import type { TiendanubeProductResponse } from './tiendanube-product.types';

@Injectable()
export class TiendanubeProductsService {
  constructor(
    private readonly connectionRepository: TiendanubeConnectionRepository,
    private readonly apiService: TiendanubeApiService,
  ) {}

  async listByUserId(
    userId: string,
  ): Promise<readonly TiendanubeProductResponse[]> {
    const connection =
      await this.connectionRepository.findCredentialsByUserId(userId);

    if (!connection || !connection.accessToken.trim()) {
      throw new UnauthorizedException(
        'Primero conectá Tiendanube desde /tiendanube/connect',
      );
    }

    const response = await this.apiService.get<unknown>(
      connection.storeId,
      '/products',
      connection.accessToken,
    );

    return TiendanubeProductMapper.mapList(response);
  }
}
