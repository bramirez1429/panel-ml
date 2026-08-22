import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { SmartPromotionService } from './smart-promotion.service';

import type { SmartPromotionUpdate } from './smart-promotion.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class SmartPromotionController {
  constructor(private readonly smartPromotionService: SmartPromotionService) {}

  @Post('clasica/:itemId/promociones/smart')
  createClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: SmartPromotionUpdate,
  ) {
    return this.smartPromotionService.createClassic(user.id, itemId, changes);
  }

  @Delete('clasica/:itemId/promociones/smart/:promotionId/:offerId')
  deleteClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Param('promotionId') promotionId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.smartPromotionService.deleteClassic(
      user.id,
      itemId,
      promotionId,
      offerId,
    );
  }

  @Post('nueva/:familyId/items/:itemId/promociones/smart')
  createNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: SmartPromotionUpdate,
  ) {
    return this.smartPromotionService.createNew(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }

  @Delete(
    'nueva/:familyId/items/:itemId/promociones/smart/:promotionId/:offerId',
  )
  deleteNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Param('promotionId') promotionId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.smartPromotionService.deleteNew(
      user.id,
      familyId,
      itemId,
      promotionId,
      offerId,
    );
  }
}
