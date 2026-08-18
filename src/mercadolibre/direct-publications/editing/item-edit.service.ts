import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { MlItem } from '../items/items.types';

import { PublicationsMapper } from '../publications/publications.mapper';

import {
  ClassicItemUpdate,
  VariantPricingItemUpdate,
} from './item-edit.types';

@Injectable()
export class ItemEditService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly itemsService: ItemsService,
  ) {}

  /**
   * Edita una publicación versión clásica / SHARED.
   */
  async updateClassic(
    itemId: string,
    changes: ClassicItemUpdate,
  ): Promise<MlItem> {
    this.validateItemId(itemId);
    this.validateChanges(changes);

    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item =
      await this.itemsService.getOne(
        itemId,
        accessToken,
      );

    const model =
      PublicationsMapper.getModel(item);

    if (model !== 'SHARED') {
      throw new BadRequestException(
        'La publicación no es versión clásica',
      );
    }

    this.validateClassicUpdate(
      item,
      changes,
    );

    return this.apiService.put<MlItem>(
      `/items/${item.id}`,
      changes,
      accessToken,
    );
  }

  /**
   * Edita una condición de venta MLA
   * perteneciente a una publicación nueva.
   */
  async updateVariantPricingItem(
    itemId: string,
    changes: VariantPricingItemUpdate,
  ): Promise<MlItem> {
    this.validateItemId(itemId);
    this.validateChanges(changes);

    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item =
      await this.itemsService.getOne(
        itemId,
        accessToken,
      );

    const model =
      PublicationsMapper.getModel(item);

    if (model !== 'VARIANT_PRICING') {
      throw new BadRequestException(
        'La publicación no es versión nueva',
      );
    }

    this.validateVariantPricingUpdate(
      changes,
    );

    return this.apiService.put<MlItem>(
      `/items/${item.id}`,
      changes,
      accessToken,
    );
  }

  /**
   * Validaciones específicas de publicaciones clásicas.
   */
  private validateClassicUpdate(
    item: MlItem,
    changes: ClassicItemUpdate,
  ): void {
    if (
      changes.title !== undefined &&
      (item.sold_quantity ?? 0) > 0
    ) {
      throw new BadRequestException(
        'No se puede modificar el título porque la publicación ya tiene ventas',
      );
    }

    if (
      changes.title !== undefined &&
      !changes.title.trim()
    ) {
      throw new BadRequestException(
        'El título no puede estar vacío',
      );
    }

    if (
      changes.price !== undefined &&
      changes.price <= 0
    ) {
      throw new BadRequestException(
        'El precio debe ser mayor a 0',
      );
    }

    if (
      changes.available_quantity !== undefined &&
      changes.available_quantity < 0
    ) {
      throw new BadRequestException(
        'El stock no puede ser negativo',
      );
    }
  }

  /**
   * Validaciones de una condición de venta
   * de VARIANT_PRICING.
   */
  private validateVariantPricingUpdate(
    changes: VariantPricingItemUpdate,
  ): void {
    if (
      changes.price !== undefined &&
      changes.price <= 0
    ) {
      throw new BadRequestException(
        'El precio debe ser mayor a 0',
      );
    }
  }

  private validateItemId(
    itemId: string,
  ): void {
    if (!/^MLA\d+$/.test(itemId)) {
      throw new BadRequestException(
        'itemId inválido',
      );
    }
  }

  private validateChanges(
    changes: object,
  ): void {
    if (
      !changes ||
      Object.keys(changes).length === 0
    ) {
      throw new BadRequestException(
        'No se enviaron cambios',
      );
    }
  }
}