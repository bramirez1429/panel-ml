import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type {
  ClassicStockUpdate,
  NewStockUpdate,
  UserProductStockResponse,
} from './stock-edit.types';

@Injectable()
export class StockEditService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly itemsService: ItemsService,
  ) {}

/** Consulta stock actual de una publicación clásica. */
async getClassicStock(itemId: string) {
  const accessToken =
    await this.tokenService.getValidAccessToken();

  const item = await this.itemsService.getOne(
    itemId,
    accessToken,
  );

  if (
    PublicationsMapper.getModel(item) !== 'SHARED'
  ) {
    throw new BadRequestException(
      'La publicación no es versión clásica',
    );
  }

  return {
    model: 'SHARED',
    itemId: item.id,
    availableQuantity:
      item.available_quantity ?? null,
    variations: item.variations ?? [],
  };
}

/** Consulta stock real de un User Product de versión nueva. */
async getNewStock(
  familyId: string,
  itemId: string,
) {
  const accessToken =
    await this.tokenService.getValidAccessToken();

  const item = await this.itemsService.getOne(
    itemId,
    accessToken,
  );

  if (
    PublicationsMapper.getModel(item) !==
    'VARIANT_PRICING'
  ) {
    throw new BadRequestException(
      'La publicación no es versión nueva',
    );
  }

  if (
    String(item.family_id ?? '') !== familyId
  ) {
    throw new BadRequestException(
      'El MLA no pertenece a la familia indicada',
    );
  }

  const userProductId =
    item.user_product_id;

  if (!userProductId) {
    throw new BadRequestException(
      'La publicación no tiene userProductId',
    );
  }

  const stock =
    await this.apiService.getWithMeta<UserProductStockResponse>(
      `/user-products/${userProductId}/stock`,
      accessToken,
    );

  return {
    model: 'VARIANT_PRICING',
    itemId: item.id,
    familyId,
    userProductId,

    itemAvailableQuantity:
      item.available_quantity ?? null,

    xVersion:
      stock.headers.get('x-version'),

    locations:
      stock.data.locations ?? [],
  };
}



  /** Stock de publicación clásica. */
  async updateClassic(
    itemId: string,
    changes: ClassicStockUpdate,
  ) {
    this.validateQuantity(changes.quantity);

    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
    );

    if (
      PublicationsMapper.getModel(item) !== 'SHARED'
    ) {
      throw new BadRequestException(
        'La publicación no es versión clásica',
      );
    }

    if (changes.variationId !== undefined) {
      return this.apiService.put(
        `/items/${itemId}`,
        {
          variations: [
            {
              id: changes.variationId,
              available_quantity: changes.quantity,
            },
          ],
        },
        accessToken,
      );
    }

    return this.apiService.put(
      `/items/${itemId}`,
      {
        available_quantity: changes.quantity,
      },
      accessToken,
    );
  }

  /** Stock de una variante de publicación nueva. */
  async updateNew(
    familyId: string,
    itemId: string,
    changes: NewStockUpdate,
  ) {
    this.validateQuantity(changes.quantity);

    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
    );

    if (
      PublicationsMapper.getModel(item) !==
      'VARIANT_PRICING'
    ) {
      throw new BadRequestException(
        'La publicación no es versión nueva',
      );
    }

    if (
      String(item.family_id ?? '') !== familyId
    ) {
      throw new BadRequestException(
        'El MLA no pertenece a la familia indicada',
      );
    }

    const userProductId =
      item.user_product_id;

    if (!userProductId) {
      throw new BadRequestException(
        'La publicación no tiene userProductId',
      );
    }

    const stock =
      await this.apiService.getWithMeta<UserProductStockResponse>(
        `/user-products/${userProductId}/stock`,
        accessToken,
      );

    const xVersion =
      stock.headers.get('x-version');

    const sellerWarehouses =
      stock.data.locations.filter(
        (location) =>
          location.type === 'seller_warehouse',
      );

    if (sellerWarehouses.length > 0) {
      if (
        !changes.storeId ||
        !changes.networkNodeId
      ) {
        throw new BadRequestException(
          'Este producto usa stock multiorigen: faltan storeId y networkNodeId',
        );
      }

      if (!xVersion) {
        throw new BadRequestException(
          'Mercado Libre no devolvió x-version',
        );
      }

      return this.apiService.putWithHeaders(
        `/user-products/${userProductId}/stock/type/seller_warehouse`,
        {
          locations: [
            {
              store_id: changes.storeId,
              network_node_id:
                changes.networkNodeId,
              quantity: changes.quantity,
            },
          ],
        },
        accessToken,
        {
          'x-version': xVersion,
        },
      );
    }

    const sellingAddress =
      stock.data.locations.some(
        (location) =>
          location.type === 'selling_address',
      );

    if (sellingAddress) {
      if (!xVersion) {
        throw new BadRequestException(
          'Mercado Libre no devolvió x-version',
        );
      }

      return this.apiService.putWithHeaders(
        `/user-products/${userProductId}/stock/type/selling_address`,
        {
          quantity: changes.quantity,
        },
        accessToken,
        {
          'x-version': xVersion,
        },
      );
    }

    // Sin gestión distribuida editable:
    // se actualiza por MLA.
    return this.apiService.put(
      `/items/${itemId}`,
      {
        available_quantity:
          changes.quantity,
      },
      accessToken,
    );
  }

  private validateQuantity(
    quantity: number,
  ): void {
    if (
      !Number.isInteger(quantity) ||
      quantity < 0
    ) {
      throw new BadRequestException(
        'El stock debe ser un entero mayor o igual a 0',
      );
    }
  }
}