import { Body, Controller, Delete, Param, Post, Put } from '@nestjs/common';

import { SellerCampaignService } from './seller-campaign.service';

import type { SellerCampaignUpdate } from './seller-campaign.types';

@Controller('mercadolibre/direct/edicion')
export class SellerCampaignController {
  constructor(private readonly sellerCampaignService: SellerCampaignService) {}

  @Post('clasica/:itemId/promociones/seller-campaign')
  createClassic(
    @Param('itemId') itemId: string,
    @Body() changes: SellerCampaignUpdate,
  ) {
    return this.sellerCampaignService.createClassic(itemId, changes);
  }

  @Put('clasica/:itemId/promociones/seller-campaign')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: SellerCampaignUpdate,
  ) {
    return this.sellerCampaignService.updateClassic(itemId, changes);
  }

  @Delete('clasica/:itemId/promociones/seller-campaign/:promotionId')
  deleteClassic(
    @Param('itemId') itemId: string,
    @Param('promotionId') promotionId: string,
  ) {
    return this.sellerCampaignService.deleteClassic(itemId, promotionId);
  }

  @Post('nueva/:familyId/items/:itemId/promociones/seller-campaign')
  createNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: SellerCampaignUpdate,
  ) {
    return this.sellerCampaignService.createNew(familyId, itemId, changes);
  }

  @Put('nueva/:familyId/items/:itemId/promociones/seller-campaign')
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: SellerCampaignUpdate,
  ) {
    return this.sellerCampaignService.updateNew(familyId, itemId, changes);
  }

  @Delete(
    'nueva/:familyId/items/:itemId/promociones/seller-campaign/:promotionId',
  )
  deleteNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Param('promotionId') promotionId: string,
  ) {
    return this.sellerCampaignService.deleteNew(familyId, itemId, promotionId);
  }
}
