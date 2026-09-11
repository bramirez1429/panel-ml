import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

@Injectable()
export class VariationDeletionService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  async deleteVariation(userId: string, itemId: string, variationId: string) {
    this.validateIds(itemId, variationId);

    const accessToken = await this.tokenService.getValidAccessToken(userId);

    await this.apiService.delete(
      `/items/${itemId}/variations/${variationId}`,
      accessToken,
      'variationDelete',
    );

    return {
      success: true,
      itemId,
      variationId,
    };
  }

  private validateIds(itemId: string, variationId: string): void {
    if (!/^MLA\d+$/.test(itemId)) {
      throw new BadRequestException('itemId inv\u00e1lido');
    }
    if (!/^\d+$/.test(variationId)) {
      throw new BadRequestException('variationId inv\u00e1lido');
    }
  }
}
