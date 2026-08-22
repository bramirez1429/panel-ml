import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { StockService } from './stock.service';

import type { ClassicStockUpdate, NewStockUpdate } from './stock.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('clasica/:itemId/stock')
  getClassic(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.stockService.getClassicStock(user.id, itemId);
  }

  @Patch('clasica/:itemId/stock')
  updateClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: ClassicStockUpdate,
  ) {
    return this.stockService.updateClassic(user.id, itemId, changes);
  }

  @Get('nueva/:familyId/items/:itemId/stock')
  getNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.stockService.getNewStock(user.id, familyId, itemId);
  }

  @Patch('nueva/:familyId/items/:itemId/stock')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: NewStockUpdate,
  ) {
    return this.stockService.updateNew(user.id, familyId, itemId, changes);
  }
}
