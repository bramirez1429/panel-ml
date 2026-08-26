import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { PromotionsCatalogQueryDto } from './promotions-catalog-query.dto';
import { PromotionsCatalogService } from './promotions-catalog.service';
import { PromotionsFacetsService } from './promotions-facets.service';

@Controller('mercadolibre/direct/promociones')
@UseGuards(AccessTokenGuard)
export class PromotionsCatalogController {
  constructor(
    private readonly catalogService: PromotionsCatalogService,
    private readonly facetsService: PromotionsFacetsService,
  ) {}

  @Get()
  getCatalog(
    @CurrentUser() user: SafeUser,
    @Query() query: PromotionsCatalogQueryDto,
  ) {
    return this.catalogService.getCatalog(user.id, query);
  }

  @Get('facets')
  getFacets(@CurrentUser() user: SafeUser) {
    return this.facetsService.getFacets(user.id);
  }
}
