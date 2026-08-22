import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { PriceDiscountService } from './price-discount.service';

import type { PriceDiscountUpdate } from './price-discount.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class PriceDiscountController {
  constructor(private readonly priceDiscountService: PriceDiscountService) {}

  @Post('clasica/:itemId/promociones/precio-descuento')
  createClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId')
    itemId: string,

    @Body()
    changes: PriceDiscountUpdate,
  ) {
    return this.priceDiscountService.createClassicPriceDiscount(
      user.id,
      itemId,
      changes,
    );
  }

  @Delete('clasica/:itemId/promociones/precio-descuento')
  deleteClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId')
    itemId: string,
  ) {
    return this.priceDiscountService.deleteClassicPriceDiscount(
      user.id,
      itemId,
    );
  }

  @Post('nueva/:familyId/items/:itemId/promociones/precio-descuento')
  createNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId')
    familyId: string,

    @Param('itemId')
    itemId: string,

    @Body()
    changes: PriceDiscountUpdate,
  ) {
    return this.priceDiscountService.createNewPriceDiscount(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }

  @Delete('nueva/:familyId/items/:itemId/promociones/precio-descuento')
  deleteNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId')
    familyId: string,

    @Param('itemId')
    itemId: string,
  ) {
    return this.priceDiscountService.deleteNewPriceDiscount(
      user.id,
      familyId,
      itemId,
    );
  }
}
