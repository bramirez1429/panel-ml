import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { PromotionsCatalogQueryDto } from './promotions-catalog-query.dto';
import { PromotionsCampaignItemsQueryDto } from './promotions-campaign-items-query.dto';
import { PromotionsCampaignsService } from './promotions-campaigns.service';
import { PromotionsCatalogService } from './promotions-catalog.service';
import { PromotionOptionsService } from './promotion-options.service';
import { PromotionBulkJobQueue } from './promotion-bulk-job.queue';
import { parsePromotionBulkJobRequest } from './promotion-bulk-job.request';
import { PromotionBulkJobService } from './promotion-bulk-job.service';
import { parsePromotionRemovalSelection } from './promotion-removal-request';
import { parsePromotionRequest } from './publication-promotion-request';
import { PublicationPromotionService } from './publication-promotion.service';
import { PromotionRemovalService } from './promotion-removal.service';
import { PromotionSelectionService } from './promotion-selection.service';
import type { PromotionSwitchRequest } from './promotion-manager.types';

@Controller('mercadolibre/direct/promociones')
@UseGuards(AccessTokenGuard)
export class PromotionsCatalogController {
  constructor(
    private readonly catalogService: PromotionsCatalogService,
    private readonly campaignsService: PromotionsCampaignsService,
    private readonly optionsService: PromotionOptionsService,
    private readonly removalService: PromotionRemovalService,
    private readonly selectionService: PromotionSelectionService,
    private readonly publicationPromotionService: PublicationPromotionService,
    private readonly bulkJobService: PromotionBulkJobService,
    private readonly bulkJobQueue: PromotionBulkJobQueue,
  ) {}

  @Get()
  getCatalog(
    @CurrentUser() user: SafeUser,
    @Query() query: PromotionsCatalogQueryDto,
  ) {
    return this.catalogService.getCatalog(user.id, query);
  }

  @Get('campaigns')
  getCampaigns(@CurrentUser() user: SafeUser) {
    return this.campaignsService.getCampaigns(user.id);
  }

  @Get('campaigns/:promotionId/items')
  getCampaignItems(
    @CurrentUser() user: SafeUser,
    @Param('promotionId') promotionId: string,
    @Query() query: PromotionsCampaignItemsQueryDto,
  ) {
    return this.campaignsService.getCampaignItems(user.id, promotionId, query);
  }

  @Get('diagnostico/:itemId')
  getPromotionDiagnostic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
  ) {
    return this.campaignsService.getPromotionDiagnostic(user.id, itemId);
  }

  @Get('publicacion/:sourceKey/preview')
  previewPublication(
    @CurrentUser() user: SafeUser,
    @Param('sourceKey') sourceKey: string,
    @Query() query: unknown,
  ) {
    return this.publicationPromotionService.preview(
      user.id,
      sourceKey,
      parsePromotionRequest(query),
    );
  }

  @Post('publicacion/:sourceKey/aplicar')
  applyPublication(
    @CurrentUser() user: SafeUser,
    @Param('sourceKey') sourceKey: string,
    @Body() body: unknown,
  ) {
    return this.publicationPromotionService.apply(
      user.id,
      sourceKey,
      parsePromotionRequest(body),
    );
  }

  @Delete('publicacion/:sourceKey')
  async removePublication(
    @CurrentUser() user: SafeUser,
    @Param('sourceKey') sourceKey: string,
    @Query() query: unknown,
  ) {
    const selection = parsePromotionRemovalSelection(query);
    return selection
      ? this.publicationPromotionService.removeSelected(
          user.id,
          sourceKey,
          selection,
        )
      : this.publicationPromotionService.remove(user.id, sourceKey);
  }

  @Post('bulk/jobs')
  async startBulkJob(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    const result = await this.bulkJobService.start(
      user.id,
      parsePromotionBulkJobRequest(body),
    );
    await this.bulkJobQueue.enqueue({ userId: user.id, jobId: result.jobId });
    return result;
  }

  @Get('bulk/jobs/:jobId')
  getBulkJob(
    @CurrentUser() user: SafeUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.bulkJobService.getStatus(user.id, jobId);
  }

  @Get(':itemId/opciones')
  getOptions(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.optionsService.getOptions(user.id, itemId);
  }

  @Delete(':itemId')
  remove(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.removalService.removeAll(user.id, itemId);
  }

  @Post(':itemId/aplicar')
  apply(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() request: PromotionSwitchRequest,
  ) {
    return this.selectionService.apply(user.id, itemId, request);
  }
}
