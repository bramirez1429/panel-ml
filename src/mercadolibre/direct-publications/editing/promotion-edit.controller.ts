import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
} from '@nestjs/common';

import { PromotionEditService } from './promotion-edit.service';

import type {
  PriceDiscountUpdate,
} from './promotion-edit.types';

@Controller('mercadolibre/direct/edicion')
export class PromotionEditController {
  constructor(
    private readonly promotionEditService:
      PromotionEditService,
  ) {}

  @Post(
    'clasica/:itemId/promociones/precio-descuento',
  )
  createClassic(
    @Param('itemId')
    itemId: string,

    @Body()
    changes: PriceDiscountUpdate,
  ) {
    return this.promotionEditService
      .createClassicPriceDiscount(
        itemId,
        changes,
      );
  }

  @Delete(
    'clasica/:itemId/promociones/precio-descuento',
  )
  deleteClassic(
    @Param('itemId')
    itemId: string,
  ) {
    return this.promotionEditService
      .deleteClassicPriceDiscount(
        itemId,
      );
  }

  @Post(
    'nueva/:familyId/items/:itemId/promociones/precio-descuento',
  )
  createNew(
    @Param('familyId')
    familyId: string,

    @Param('itemId')
    itemId: string,

    @Body()
    changes: PriceDiscountUpdate,
  ) {
    return this.promotionEditService
      .createNewPriceDiscount(
        familyId,
        itemId,
        changes,
      );
  }

  @Delete(
    'nueva/:familyId/items/:itemId/promociones/precio-descuento',
  )
  deleteNew(
    @Param('familyId')
    familyId: string,

    @Param('itemId')
    itemId: string,
  ) {
    return this.promotionEditService
      .deleteNewPriceDiscount(
        familyId,
        itemId,
      );
  }
}