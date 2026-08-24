import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { TiendanubeReplicationStatusQueryDto } from './tiendanube-replication-status.dto';
import { TiendanubeReplicationStatusService } from './tiendanube-replication-status.service';
import type { TiendanubeReplicationStatusResponse } from './tiendanube-replication-status.types';
import type { TiendanubeReplicationResult } from './tiendanube-replication-result.types';
import { TiendanubeReplicationService } from './tiendanube-replication.service';

@Controller('tiendanube/replication')
@UseGuards(AccessTokenGuard)
export class TiendanubeReplicationController {
  constructor(
    private readonly replicationService: TiendanubeReplicationService,
    private readonly replicationStatusService: TiendanubeReplicationStatusService,
  ) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  getReplicationStatus(
    @CurrentUser() user: SafeUser,
    @Query() query: TiendanubeReplicationStatusQueryDto,
  ): Promise<TiendanubeReplicationStatusResponse> {
    return this.replicationStatusService.getStatus(user.id, query.productIds);
  }

  @Post('mercadolibre/:productId')
  @Header('Cache-Control', 'no-store')
  replicateMercadoLibrePublication(
    @CurrentUser() user: SafeUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<TiendanubeReplicationResult> {
    return this.replicationService.replicate(user.id, productId);
  }
}
