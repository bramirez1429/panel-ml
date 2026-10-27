import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import {
  TiendanubeSizeStockService,
  type TiendanubeSizeStockBatchRequest,
} from './tiendanube-size-stock.service';

@Controller('tiendanube/size-stock')
@UseGuards(AccessTokenGuard)
export class TiendanubeSizeStockController {
  constructor(private readonly service: TiendanubeSizeStockService) {}

  @Get('status')
  status() { return { ready: true, colorScoped: true }; }

  @Post('apply-batch')
  applyBatch(
    @CurrentUser() user: SafeUser,
    @Body() body: TiendanubeSizeStockBatchRequest,
  ) {
    return this.service.applyBatch(user.id, body);
  }
}
