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

import { SellerCampaignService } from './seller-campaign.service';

import type { SellerCampaignUpdate } from './seller-campaign.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class SellerCampaignController {
  constructor(private readonly sellerCampaignService: SellerCampaignService) {}

  @Post('clasica/:itemId/promociones/seller-campaign')
  createClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: SellerCampaignUpdate,
  ) {
    return this.sellerCampaignService.createClassic(user.id, itemId, changes);
  }

  @Put('clasica/:itemId/promociones/seller-campaign')
  updateClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: SellerCampaignUpdate,
  ) {
    return this.sellerCampaignService.updateClassic(user.id, itemId, changes);
  }

  @Delete('clasica/:itemId/promociones/seller-campaign/:promotionId')
  deleteClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Param('promotionId') promotionId: string,
  ) {
    return this.sellerCampaignService.deleteClassic(
      user.id,
      itemId,
      promotionId,
    );
  }

  @Post('nueva/:familyId/items/:itemId/promociones/seller-campaign')
  createNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: SellerCampaignUpdate,
  ) {
    return this.sellerCampaignService.createNew(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }

  @Put('nueva/:familyId/items/:itemId/promociones/seller-campaign')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: SellerCampaignUpdate,
  ) {
    return this.sellerCampaignService.updateNew(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }

  @Delete(
    'nueva/:familyId/items/:itemId/promociones/seller-campaign/:promotionId',
  )
  deleteNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Param('promotionId') promotionId: string,
  ) {
    return this.sellerCampaignService.deleteNew(
      user.id,
      familyId,
      itemId,
      promotionId,
    );
  }
}
