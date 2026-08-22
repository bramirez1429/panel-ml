import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { SkuService } from './sku.service';

import type { ClassicSkuUpdate, NewSkuUpdate } from './sku.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class SkuController {
  constructor(private readonly skuService: SkuService) {}

  @Get('clasica/:itemId/sku')
  getClassic(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.skuService.getClassicSku(user.id, itemId);
  }

  @Patch('clasica/:itemId/sku')
  updateClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: ClassicSkuUpdate,
  ) {
    return this.skuService.updateClassicSku(user.id, itemId, changes);
  }

  @Get('nueva/:familyId/items/:itemId/sku')
  getNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.skuService.getNewSku(user.id, familyId, itemId);
  }

  @Patch('nueva/:familyId/items/:itemId/sku')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: NewSkuUpdate,
  ) {
    return this.skuService.updateNewSku(user.id, familyId, itemId, changes);
  }
}
