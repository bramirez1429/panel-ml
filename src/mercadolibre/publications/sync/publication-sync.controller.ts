import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';
import type {
  SyncJobStartResponse,
  SyncJobStatusResponse,
} from './publication-sync-job.types';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncQueueService } from './publication-sync-queue.service';

@Controller('mercadolibre/publicaciones/sync')
@UseGuards(AccessTokenGuard)
export class PublicationSyncController {
  constructor(
    private readonly syncJobService: PublicationSyncJobService,
    private readonly syncQueue: PublicationSyncQueueService,
  ) {}

  @Post()
  async start(@CurrentUser() user: SafeUser): Promise<SyncJobStartResponse> {
    const result = await this.syncJobService.start(user.id);
    if (result.status === 'PENDING') {
      await this.syncQueue.enqueue(user.id, result.syncId);
    }
    return result;
  }

  @Get('active')
  getActive(
    @CurrentUser() user: SafeUser,
  ): Promise<SyncJobStatusResponse | null> {
    return this.syncJobService.getActive(user.id);
  }

  @Post(':syncId/cancel')
  cancel(
    @CurrentUser() user: SafeUser,
    @Param('syncId', ParseUUIDPipe) syncId: string,
  ): Promise<SyncJobStatusResponse> {
    return this.syncJobService.cancel(user.id, syncId);
  }

  @Get(':syncId')
  getStatus(
    @CurrentUser() user: SafeUser,
    @Param('syncId', ParseUUIDPipe) syncId: string,
  ): Promise<SyncJobStatusResponse> {
    return this.syncJobService.getStatus(user.id, syncId);
  }
}
