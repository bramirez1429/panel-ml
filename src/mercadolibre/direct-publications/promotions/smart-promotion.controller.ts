import { Body, Controller, Delete, Param, Post } from '@nestjs/common';

import { SmartPromotionService } from './smart-promotion.service';

import type { SmartPromotionUpdate } from './smart-promotion.types';

@Controller('mercadolibre/direct/edicion')
export class SmartPromotionController {
  constructor(private readonly smartPromotionService: SmartPromotionService) {}

  @Post('clasica/:itemId/promociones/smart')
  createClassic(
    @Param('itemId') itemId: string,
    @Body() changes: SmartPromotionUpdate,
  ) {
    return this.smartPromotionService.createClassic(itemId, changes);
  }

  @Delete('clasica/:itemId/promociones/smart/:promotionId/:offerId')
  deleteClassic(
    @Param('itemId') itemId: string,
    @Param('promotionId') promotionId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.smartPromotionService.deleteClassic(
      itemId,
      promotionId,
      offerId,
    );
  }

  @Post('nueva/:familyId/items/:itemId/promociones/smart')
  createNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: SmartPromotionUpdate,
  ) {
    return this.smartPromotionService.createNew(familyId, itemId, changes);
  }

  @Delete(
    'nueva/:familyId/items/:itemId/promociones/smart/:promotionId/:offerId',
  )
  deleteNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Param('promotionId') promotionId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.smartPromotionService.deleteNew(
      familyId,
      itemId,
      promotionId,
      offerId,
    );
  }
}
