import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';
import type { SafeUser } from '../../../auth/domain/auth.models';
import { ProductRankingService } from './product-ranking.service';

@Controller('mercadolibre/direct/ranking-productos')
@UseGuards(AccessTokenGuard)
export class ProductRankingController {
  constructor(private readonly service: ProductRankingService) {}

  @Get()
  getRanking() {
    return this.service.getRanking();
  }

  @Get(':type/:id/variantes')
  getVariants(
    @CurrentUser() user: SafeUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.service.getVariants(user.id, type, id);
  }
}
