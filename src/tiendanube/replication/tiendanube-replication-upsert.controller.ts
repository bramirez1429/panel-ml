import {
  Body,
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
import type { TiendanubeReplicationUpsertResult } from './tiendanube-replication-result.types';
import type { TiendanubeSourceReplicationResult } from './tiendanube-replication-result.types';
import { TiendanubeReplicationSourceDto } from './tiendanube-replication-source.dto';
import { TiendanubeReplicationService } from './tiendanube-replication.service';

@Controller('tiendanube')
@UseGuards(AccessTokenGuard)
export class TiendanubeReplicationUpsertController {
  constructor(
    private readonly replicationService: TiendanubeReplicationService,
  ) {}

  @Post('replicate/source')
  @Header('Cache-Control', 'no-store')
  replicateSource(
    @CurrentUser() user: SafeUser,
    @Body() body: TiendanubeReplicationSourceDto,
  ): Promise<TiendanubeSourceReplicationResult> {
    return this.replicationService.replicateOrUpdateBySourceKey(
      user.id,
      body.sourceKey,
    );
  }

  @Post('replicate/:sourceId')
  @Header('Cache-Control', 'no-store')
  replicate(
    @CurrentUser() user: SafeUser,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
  ): Promise<TiendanubeReplicationUpsertResult> {
    return this.replicationService.replicateOrUpdateBySourceId(
      user.id,
      sourceId,
    );
  }
}
