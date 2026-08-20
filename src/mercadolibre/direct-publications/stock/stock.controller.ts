import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { StockService } from './stock.service';

import type {
  ClassicStockUpdate,
  NewStockUpdate,
} from './stock.types';

@Controller('mercadolibre/direct/edicion')
export class StockController {
  constructor(
    private readonly stockService:
      StockService,
  ) {}

  @Get('clasica/:itemId/stock')
  getClassic(
    @Param('itemId') itemId: string,
  ) {
    return this.stockService.getClassicStock(
      itemId,
    );
  }

  @Patch('clasica/:itemId/stock')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: ClassicStockUpdate,
  ) {
    return this.stockService.updateClassic(
      itemId,
      changes,
    );
  }

  @Get('nueva/:familyId/items/:itemId/stock')
  getNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.stockService.getNewStock(
      familyId,
      itemId,
    );
  }

  @Patch('nueva/:familyId/items/:itemId/stock')
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: NewStockUpdate,
  ) {
    return this.stockService.updateNew(
      familyId,
      itemId,
      changes,
    );
  }
}
