import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { DealService } from './deal.service';

import type { DealUpdate } from './deal.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class DealController {
  constructor(private readonly dealService: DealService) {}

  @Post('clasica/:itemId/promociones/deal')
  createClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: DealUpdate,
  ) {
    return this.dealService.createClassic(user.id, itemId, changes);
  }

  @Put('clasica/:itemId/promociones/deal')
  updateClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: DealUpdate,
  ) {
    return this.dealService.updateClassic(user.id, itemId, changes);
  }

  @Delete('clasica/:itemId/promociones/deal/:promotionId')
  deleteClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Param('promotionId')
    promotionId: string,
  ) {
    return this.dealService.deleteClassic(user.id, itemId, promotionId);
  }

  @Post('nueva/:familyId/items/:itemId/promociones/deal')
  createNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: DealUpdate,
  ) {
    return this.dealService.createNew(user.id, familyId, itemId, changes);
  }

  @Put('nueva/:familyId/items/:itemId/promociones/deal')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: DealUpdate,
  ) {
    return this.dealService.updateNew(user.id, familyId, itemId, changes);
  }

  @Delete('nueva/:familyId/items/:itemId/promociones/deal/:promotionId')
  deleteNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Param('promotionId')
    promotionId: string,
  ) {
    return this.dealService.deleteNew(user.id, familyId, itemId, promotionId);
  }
}
