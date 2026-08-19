import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { ShippingEditService } from './shipping-edit.service';

import type {
  ShippingUpdate,
} from './shipping-edit.types';

@Controller('mercadolibre/direct/edicion')
export class ShippingEditController {
  constructor(
    private readonly shippingEditService:
      ShippingEditService,
  ) {}

  @Get('clasica/:itemId/envio')
  getClassic(
    @Param('itemId') itemId: string,
  ) {
    return this.shippingEditService.getClassic(
      itemId,
    );
  }

  @Patch('clasica/:itemId/envio')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: ShippingUpdate,
  ) {
    return this.shippingEditService.updateClassic(
      itemId,
      changes,
    );
  }

  @Get(
    'nueva/:familyId/items/:itemId/envio',
  )
  getNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.shippingEditService.getNew(
      familyId,
      itemId,
    );
  }

  @Patch(
    'nueva/:familyId/items/:itemId/envio',
  )
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: ShippingUpdate,
  ) {
    return this.shippingEditService.updateNew(
      familyId,
      itemId,
      changes,
    );
  }
}