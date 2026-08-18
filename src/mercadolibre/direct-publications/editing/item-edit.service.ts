import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { MlItem } from '../items/items.types';

import { PublicationsMapper } from '../publications/publications.mapper';

import type {
  ClassicItemUpdate,
  VariantPricingItemUpdate,
} from './item-edit.types';

const CLASSIC_ALLOWED_FIELDS = new Set([
  'title',
  'price',
  'available_quantity',
  'status',
  'pictures',
  'video_id',
  'attributes',
  'shipping',
  'sale_terms',
  'listing_type_id',
  'category_id',
  'currency_id',
]);

const NEW_ALLOWED_FIELDS = new Set([
  'price',
  'status',
  'shipping',
  'sale_terms',
  'listing_type_id',
  'catalog_listing',
  'channels',
  'tags',
  'category_id',
  'currency_id',
  'catalog_product_id',
  'buying_mode',
  'official_store_id',
]);

const ALLOWED_STATUSES = new Set([
  'active',
  'paused',
  'closed',
]);

@Injectable()
export class ItemEditService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly itemsService: ItemsService,
  ) {}

  /** Edita una publicación versión clásica. */
  async updateClassic(
    itemId: string,
    changes: ClassicItemUpdate,
  ): Promise<MlItem> {
    this.validateItemId(itemId);
    this.validateChanges(changes);

    this.validateAllowedFields(
      changes,
      CLASSIC_ALLOWED_FIELDS,
    );

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

  /** Edita un MLA perteneciente a una publicación nueva. */
async updateVariantPricingItem(
  familyId: string,
  itemId: string,
  changes: VariantPricingItemUpdate,
): Promise<MlItem> {
  this.validateItemId(itemId);
  this.validateChanges(changes);

  this.validateAllowedFields(
    changes,
    NEW_ALLOWED_FIELDS,
  );

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

  const itemFamilyId =
    item.family_id !== null &&
    item.family_id !== undefined
      ? String(item.family_id)
      : null;

  if (itemFamilyId !== familyId) {
    throw new BadRequestException(
      'El MLA no pertenece a la familia indicada',
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

  private validateClassicUpdate(
    item: MlItem,
    changes: ClassicItemUpdate,
  ): void {
    this.validateCommonValues(changes);

    if (changes.title !== undefined) {
      if ((item.sold_quantity ?? 0) > 0) {
        throw new BadRequestException(
          'No se puede modificar el título porque la publicación ya tiene ventas',
        );
      }

      if (!changes.title.trim()) {
        throw new BadRequestException(
          'El título no puede estar vacío',
        );
      }
    }

    if (
      changes.available_quantity !== undefined &&
      (
        !Number.isInteger(changes.available_quantity) ||
        changes.available_quantity < 0
      )
    ) {
      throw new BadRequestException(
        'El stock debe ser un número entero mayor o igual a 0',
      );
    }
  }

  private validateVariantPricingUpdate(
    changes: VariantPricingItemUpdate,
  ): void {
    this.validateCommonValues(changes);
  }

  private validateCommonValues(
    changes:
      | ClassicItemUpdate
      | VariantPricingItemUpdate,
  ): void {
    if (
      changes.price !== undefined &&
      (
        !Number.isFinite(changes.price) ||
        changes.price <= 0
      )
    ) {
      throw new BadRequestException(
        'El precio debe ser mayor a 0',
      );
    }

    if (
      changes.status !== undefined &&
      !ALLOWED_STATUSES.has(changes.status)
    ) {
      throw new BadRequestException(
        'Estado inválido',
      );
    }
  }

  private validateAllowedFields(
    changes: object,
    allowedFields: Set<string>,
  ): void {
    const invalidFields =
      Object.keys(changes).filter(
        (field) => !allowedFields.has(field),
      );

    if (invalidFields.length > 0) {
      throw new BadRequestException({
        message:
          'Se enviaron campos no permitidos para este tipo de publicación',
        invalidFields,
      });
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
      typeof changes !== 'object' ||
      Array.isArray(changes) ||
      Object.keys(changes).length === 0
    ) {
      throw new BadRequestException(
        'No se enviaron cambios',
      );
    }
  }
}