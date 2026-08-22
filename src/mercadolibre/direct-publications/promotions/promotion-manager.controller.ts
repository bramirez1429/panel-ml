import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { PromotionManagerService } from './promotion-manager.service';

import type { PromotionSwitchRequest } from './promotion-manager.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class PromotionManagerController {
  constructor(
    private readonly promotionManagerService: PromotionManagerService,
  ) {}

  @Post('clasica/:itemId/promociones/cambiar')
  switchClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() request: PromotionSwitchRequest,
  ) {
    return this.promotionManagerService.switchClassic(user.id, itemId, request);
  }

  @Post('nueva/:familyId/items/:itemId/promociones/cambiar')
  switchNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() request: PromotionSwitchRequest,
  ) {
    return this.promotionManagerService.switchNew(
      user.id,
      familyId,
      itemId,
      request,
    );
  }
}
