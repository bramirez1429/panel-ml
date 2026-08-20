import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
} from '@nestjs/common';

import { PriceDiscountService } from './price-discount.service';

import type {
  PriceDiscountUpdate,
} from './price-discount.types';

@Controller('mercadolibre/direct/edicion')
export class PriceDiscountController {
  constructor(
    private readonly priceDiscountService:
      PriceDiscountService,
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
    return this.priceDiscountService
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
    return this.priceDiscountService
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
    return this.priceDiscountService
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
    return this.priceDiscountService
      .deleteNewPriceDiscount(
        familyId,
        itemId,
      );
  }
}