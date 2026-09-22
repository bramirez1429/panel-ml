import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';
import { StockBulkDispatcher } from './stock-bulk-dispatcher';
import { StockBulkJobService } from './stock-bulk-job.service';
import { StockBulkPreviewService } from './stock-bulk-preview.service';
import {
  parseStockBulkJobRequest,
  parseStockBulkPreviewRequest,
} from './stock-bulk.types';

@Controller('mercadolibre/direct/stock-bulk')
@UseGuards(AccessTokenGuard)
export class StockBulkController {
  constructor(
    private readonly previewService: StockBulkPreviewService,
    private readonly jobService: StockBulkJobService,
    private readonly dispatcher: StockBulkDispatcher,
  ) {}

  @Post('preview')
  preview(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    return this.previewService.preview(
      user.id,
      parseStockBulkPreviewRequest(body),
    );
  }

  @Post('jobs')
  async startJob(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    const result = await this.jobService.start(
      user.id,
      parseStockBulkJobRequest(body),
    );
    const dispatch = await this.dispatcher.dispatch({
      userId: user.id,
      jobId: result.jobId,
    });
    return dispatch.status === 'FAILED' ? { ...result, dispatch } : result;
  }

  @Get('jobs/:jobId')
  getJob(
    @CurrentUser() user: SafeUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobService.getStatus(user.id, jobId);
  }

  @Post('jobs/:jobId/retry-errors')
  async retryErrors(
    @CurrentUser() user: SafeUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const result = await this.jobService.retryErrors(user.id, jobId);
    if (result.retriedItems > 0) {
      const dispatch = await this.dispatcher.dispatch({
        userId: user.id,
        jobId,
      });
      return dispatch.status === 'FAILED' ? { ...result, dispatch } : result;
    }
    return result;
  }
}
