import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationsMapper } from '../publications/publications.mapper';
import { ItemsService } from './items.service';

@Injectable()
export class VariationDeletionService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly itemsService: ItemsService,
  ) {}

  async deleteVariation(userId: string, itemId: string, variationId: string) {
    this.validateIds(itemId, variationId);

    const accessToken = await this.tokenService.getValidAccessToken(userId);
    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) === 'VARIANT_PRICING') {
      throw new UnprocessableEntityException({
        success: false,
        code: 'USER_PRODUCT_VARIATION_DELETE_NOT_SUPPORTED',
        message:
          'Esta variante pertenece al modelo USER_PRODUCT y requiere otro mecanismo de eliminaci\u00f3n.',
      });
    }

    await this.apiService.delete(
      `/items/${item.id}/variations/${variationId}`,
      accessToken,
      'variationDelete',
    );

    return {
      success: true,
      model: 'LEGACY' as const,
      itemId: item.id,
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
