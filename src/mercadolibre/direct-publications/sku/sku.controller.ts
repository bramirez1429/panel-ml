import { Body, Controller, Get, Param, Patch } from '@nestjs/common';

import { SkuService } from './sku.service';

import type { ClassicSkuUpdate, NewSkuUpdate } from './sku.types';

@Controller('mercadolibre/direct/edicion')
export class SkuController {
  constructor(private readonly skuService: SkuService) {}

  @Get('clasica/:itemId/sku')
  getClassic(@Param('itemId') itemId: string) {
    return this.skuService.getClassicSku(itemId);
  }

  @Patch('clasica/:itemId/sku')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: ClassicSkuUpdate,
  ) {
    return this.skuService.updateClassicSku(itemId, changes);
  }

  @Get('nueva/:familyId/items/:itemId/sku')
  getNew(@Param('familyId') familyId: string, @Param('itemId') itemId: string) {
    return this.skuService.getNewSku(familyId, itemId);
  }

  @Patch('nueva/:familyId/items/:itemId/sku')
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: NewSkuUpdate,
  ) {
    return this.skuService.updateNewSku(familyId, itemId, changes);
  }
}
