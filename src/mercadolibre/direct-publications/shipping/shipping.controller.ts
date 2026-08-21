import { Body, Controller, Get, Param, Patch } from '@nestjs/common';

import { ShippingService } from './shipping.service';

import type { ShippingUpdate } from './shipping.types';

@Controller('mercadolibre/direct/edicion')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Get('clasica/:itemId/envio')
  getClassic(@Param('itemId') itemId: string) {
    return this.shippingService.getClassic(itemId);
  }

  @Patch('clasica/:itemId/envio')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: ShippingUpdate,
  ) {
    return this.shippingService.updateClassic(itemId, changes);
  }

  @Get('nueva/:familyId/items/:itemId/envio')
  getNew(@Param('familyId') familyId: string, @Param('itemId') itemId: string) {
    return this.shippingService.getNew(familyId, itemId);
  }

  @Patch('nueva/:familyId/items/:itemId/envio')
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: ShippingUpdate,
  ) {
    return this.shippingService.updateNew(familyId, itemId, changes);
  }
}
