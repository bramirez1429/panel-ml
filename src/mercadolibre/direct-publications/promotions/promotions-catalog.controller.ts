import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { PromotionsCatalogQueryDto } from './promotions-catalog-query.dto';
import { PromotionsCatalogService } from './promotions-catalog.service';
import { PromotionOptionsService } from './promotion-options.service';
import { PromotionRemovalService } from './promotion-removal.service';
import { PromotionSelectionService } from './promotion-selection.service';
import type { PromotionSwitchRequest } from './promotion-manager.types';

@Controller('mercadolibre/direct/promociones')
@UseGuards(AccessTokenGuard)
export class PromotionsCatalogController {
  constructor(
    private readonly catalogService: PromotionsCatalogService,
    private readonly optionsService: PromotionOptionsService,
    private readonly removalService: PromotionRemovalService,
    private readonly selectionService: PromotionSelectionService,
  ) {}

  @Get()
  getCatalog(
    @CurrentUser() user: SafeUser,
    @Query() query: PromotionsCatalogQueryDto,
  ) {
    return this.catalogService.getCatalog(user.id, query);
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
