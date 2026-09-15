import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/domain/auth.models';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import { CreateVariantLinkDto } from './dto/create-variant-link.dto';
import { RecentSalesService } from './recent-sales.service';
import { SalesSyncService } from './sales-sync.service';
import { VariantLinkService } from './variant-link.service';

@Controller('sales')
@UseGuards(AccessTokenGuard)
export class SalesController {
  constructor(
    private readonly recentSales: RecentSalesService,
    private readonly variantLinks: VariantLinkService,
    private readonly salesSync: SalesSyncService,
  ) {}

  @Get('recent')
  listRecent(@CurrentUser() user: SafeUser, @Query('hours') hours?: string) {
    return this.recentSales.list(user.id, hours);
  }

  @Get('recent/:saleId/variants')
  detail(@CurrentUser() user: SafeUser, @Param('saleId') saleId: string) {
    return this.recentSales.detail(user.id, saleId);
  }


  @Post('sync')
  sync(
    @CurrentUser() user: SafeUser,
    @Query('hours') hours?: string,
  ) {
    return this.salesSync.sync(user.id, hours);
  }

  @Post('variant-links')
  createLink(
    @CurrentUser() user: SafeUser,
    @Body() input: CreateVariantLinkDto,
  ) {
    return this.variantLinks.create(user.id, input);
  }
}
