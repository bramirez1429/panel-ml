import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { ShippingService } from './shipping.service';

import type { ShippingUpdate } from './shipping.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('clasica/:itemId/envio')
  getClassic(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.shippingService.getClassic(user.id, itemId);
  }

  @Patch('clasica/:itemId/envio')
  updateClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: ShippingUpdate,
  ) {
    return this.shippingService.updateClassic(user.id, itemId, changes);
  }

  @Get('nueva/:familyId/items/:itemId/envio')
  getNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.shippingService.getNew(user.id, familyId, itemId);
  }

  @Patch('nueva/:familyId/items/:itemId/envio')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: ShippingUpdate,
  ) {
    return this.shippingService.updateNew(user.id, familyId, itemId, changes);
  }
}
