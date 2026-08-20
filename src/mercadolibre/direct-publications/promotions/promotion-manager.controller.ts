import {
  Body,
  Controller,
  Param,
  Post,
} from '@nestjs/common';

import { PromotionManagerService } from './promotion-manager.service';

import type {
  PromotionSwitchRequest,
} from './promotion-manager.types';

@Controller('mercadolibre/direct/edicion')
export class PromotionManagerController {
  constructor(
    private readonly promotionManagerService:
      PromotionManagerService,
  ) {}

  @Post(
    'clasica/:itemId/promociones/cambiar',
  )
  switchClassic(
    @Param('itemId') itemId: string,
    @Body() request: PromotionSwitchRequest,
  ) {
    return this.promotionManagerService.switchClassic(
      itemId,
      request,
    );
  }

  @Post(
    'nueva/:familyId/items/:itemId/promociones/cambiar',
  )
  switchNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() request: PromotionSwitchRequest,
  ) {
    return this.promotionManagerService.switchNew(
      familyId,
      itemId,
      request,
    );
  }
}
