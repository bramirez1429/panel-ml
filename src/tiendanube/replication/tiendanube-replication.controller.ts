import {
  Controller,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { TiendanubeReplicationResult } from './tiendanube-replication-result.types';
import { TiendanubeReplicationService } from './tiendanube-replication.service';

@Controller('tiendanube/replication')
@UseGuards(AccessTokenGuard)
export class TiendanubeReplicationController {
  constructor(
    private readonly replicationService: TiendanubeReplicationService,
  ) {}

  @Post('mercadolibre/:productId')
  @Header('Cache-Control', 'no-store')
  replicateMercadoLibrePublication(
    @CurrentUser() user: SafeUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<TiendanubeReplicationResult> {
    return this.replicationService.replicate(user.id, productId);
  }
}
