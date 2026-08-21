import { Body, Controller, Delete, Param, Post, Put } from '@nestjs/common';

import { DealService } from './deal.service';

import type { DealUpdate } from './deal.types';

@Controller('mercadolibre/direct/edicion')
export class DealController {
  constructor(private readonly dealService: DealService) {}

  @Post('clasica/:itemId/promociones/deal')
  createClassic(@Param('itemId') itemId: string, @Body() changes: DealUpdate) {
    return this.dealService.createClassic(itemId, changes);
  }

  @Put('clasica/:itemId/promociones/deal')
  updateClassic(@Param('itemId') itemId: string, @Body() changes: DealUpdate) {
    return this.dealService.updateClassic(itemId, changes);
  }

  @Delete('clasica/:itemId/promociones/deal/:promotionId')
  deleteClassic(
    @Param('itemId') itemId: string,
    @Param('promotionId')
    promotionId: string,
  ) {
    return this.dealService.deleteClassic(itemId, promotionId);
  }

  @Post('nueva/:familyId/items/:itemId/promociones/deal')
  createNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: DealUpdate,
  ) {
    return this.dealService.createNew(familyId, itemId, changes);
  }

  @Put('nueva/:familyId/items/:itemId/promociones/deal')
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: DealUpdate,
  ) {
    return this.dealService.updateNew(familyId, itemId, changes);
  }

  @Delete('nueva/:familyId/items/:itemId/promociones/deal/:promotionId')
  deleteNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Param('promotionId')
    promotionId: string,
  ) {
    return this.dealService.deleteNew(familyId, itemId, promotionId);
  }
}
