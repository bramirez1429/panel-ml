import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type { MlItem } from '../items/items.types';

import type { ShippingInfo, ShippingUpdate } from './shipping.types';

@Injectable()
export class ShippingService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,

    private readonly apiService: MercadolibreApiService,

    private readonly itemsService: ItemsService,
  ) {}

  async getClassic(itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return {
      model: 'SHARED',
      itemId: item.id,
      shipping: this.mapShipping(item),
    };
  }

  async updateClassic(itemId: string, changes: ShippingUpdate) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    const shipping = this.buildShippingUpdate(item, changes);

    return this.apiService.put<MlItem>(
      `/items/${item.id}`,
      {
        shipping,
      },
      accessToken,
    );
  }

  async getNew(familyId: string, itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNew(familyId, item);

    return {
      model: 'VARIANT_PRICING',
      familyId,
      itemId: item.id,
      userProductId: item.user_product_id ?? null,
      shipping: this.mapShipping(item),
    };
  }

  async updateNew(familyId: string, itemId: string, changes: ShippingUpdate) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNew(familyId, item);

    const shipping = this.buildShippingUpdate(item, changes);

    return this.apiService.put<MlItem>(
      `/items/${item.id}`,
      {
        shipping,
      },
      accessToken,
    );
  }

  private buildShippingUpdate(
    item: MlItem,
    changes: ShippingUpdate,
  ): Record<string, boolean> {
    if (
      changes.freeShipping === undefined &&
      changes.localPickUp === undefined
    ) {
      throw new BadRequestException('Debes enviar freeShipping o localPickUp');
    }

    if (
      changes.freeShipping !== undefined &&
      typeof changes.freeShipping !== 'boolean'
    ) {
      throw new BadRequestException('freeShipping debe ser boolean');
    }

    if (
      changes.localPickUp !== undefined &&
      typeof changes.localPickUp !== 'boolean'
    ) {
      throw new BadRequestException('localPickUp debe ser boolean');
    }

    const tags = item.shipping?.tags ?? [];

    if (
      changes.freeShipping === false &&
      tags.includes('mandatory_free_shipping')
    ) {
      throw new BadRequestException(
        'Mercado Libre exige envío gratis para esta publicación',
      );
    }

    return {
      ...(changes.freeShipping !== undefined
        ? {
            free_shipping: changes.freeShipping,
          }
        : {}),

      ...(changes.localPickUp !== undefined
        ? {
            local_pick_up: changes.localPickUp,
          }
        : {}),
    };
  }

  private mapShipping(item: MlItem): ShippingInfo {
    const shipping = item.shipping;

    const tags = shipping?.tags ?? [];

    const logisticType = shipping?.logistic_type ?? null;

    return {
      mode: shipping?.mode ?? null,

      logisticType,

      freeShipping: shipping?.free_shipping ?? false,

      localPickUp: shipping?.local_pick_up ?? false,

      storePickUp: shipping?.store_pick_up ?? false,

      mandatoryFreeShipping: tags.includes('mandatory_free_shipping'),

      isFlex: logisticType === 'self_service',

      isFull: logisticType === 'fulfillment',

      isDropOff: logisticType === 'drop_off' || logisticType === 'xd_drop_off',

      tags,
    };
  }

  private validateNew(familyId: string, item: MlItem): void {
    if (PublicationsMapper.getModel(item) !== 'VARIANT_PRICING') {
      throw new BadRequestException('La publicación no es versión nueva');
    }

    if (String(item.family_id ?? '') !== familyId) {
      throw new BadRequestException(
        'El MLA no pertenece a la familia indicada',
      );
    }

    if (!item.user_product_id) {
      throw new BadRequestException('La publicación no tiene userProductId');
    }
  }
}
