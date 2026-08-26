import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { TiendanubeCategoriesService } from './tiendanube-categories.service';
import type {
  TiendanubeCategoriesResponse,
  TiendanubeStoreSummary,
} from './tiendanube-category.types';

@Controller('tiendanube')
@UseGuards(AccessTokenGuard)
export class TiendanubeCategoriesController {
  constructor(private readonly service: TiendanubeCategoriesService) {}

  @Get('categories')
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() user: SafeUser,
  ): Promise<TiendanubeCategoriesResponse> {
    return { items: await this.service.listByUserId(user.id) };
  }

  @Get('store-summary')
  @Header('Cache-Control', 'no-store')
  summary(@CurrentUser() user: SafeUser): Promise<TiendanubeStoreSummary> {
    return this.service.storeSummaryByUserId(user.id);
  }
}
