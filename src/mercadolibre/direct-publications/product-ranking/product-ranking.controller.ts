import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';
import type { SafeUser } from '../../../auth/domain/auth.models';
import { ProductRankingService } from './product-ranking.service';
import { parseProductRankingVisitPeriod } from './product-ranking-period';

@Controller('mercadolibre/direct/ranking-productos')
@UseGuards(AccessTokenGuard)
export class ProductRankingController {
  constructor(private readonly service: ProductRankingService) {}

  @Get()
  getRanking(@Query('days') days: unknown) {
    return this.service.getRanking(parseProductRankingVisitPeriod(days));
  }

  @Get(':type/:id/variantes')
  getVariants(
    @CurrentUser() user: SafeUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query('days') days: unknown,
  ) {
    return this.service.getVariants(
      user.id,
      type,
      id,
      parseProductRankingVisitPeriod(days),
    );
  }
}
