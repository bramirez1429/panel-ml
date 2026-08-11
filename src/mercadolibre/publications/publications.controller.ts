import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PublicationsService } from './publications.service';
import {
  PUBLICATION_SYNC_INTERNAL_SECRET_HEADER,
  PublicationSyncDispatcherService,
} from './sync/publication-sync-dispatcher.service';
import { PublicationSyncJobService } from './sync/publication-sync-job.service';

@Controller('mercadolibre/publicaciones')
export class PublicationsController {
  /** Recibe consultas de publicaciones y administración de jobs. */
  constructor(
    private readonly publicationsService: PublicationsService,
    private readonly syncJobService: PublicationSyncJobService,
    private readonly syncDispatcher: PublicationSyncDispatcherService,
  ) {}

  /** Crea una sincronización y agenda su primer bloque. */
  @Post('sync')
  async startSync() {
    const result = await this.syncJobService.start();

    this.syncDispatcher.defer(
      result.syncId,
      this.syncDispatcher.dispatchNext(result.syncId),
    );
    return result;
  }

  /** Procesa manualmente un único bloque para debugging. */
  @Post('sync/:syncId/next')
  processNext(@Param('syncId', ParseUUIDPipe) syncId: string) {
    return this.syncJobService.processNext(syncId);
  }

  /** Recibe una invocación interna autenticada. */
  @Post('sync/:syncId/internal-next')
  @HttpCode(202)
  processInternalNext(
    @Param('syncId', ParseUUIDPipe) syncId: string,
    @Headers(PUBLICATION_SYNC_INTERNAL_SECRET_HEADER)
    internalSecret?: string,
  ) {
    this.syncDispatcher.assertInternalSecret(internalSecret);
    this.syncDispatcher.defer(syncId, this.processAutomaticBatch(syncId));

    return { ok: true, syncId, status: 'ACCEPTED' as const };
  }

  /** Consulta el estado acumulado de una sincronización. */
  @Get('sync/:syncId')
  getSyncStatus(@Param('syncId', ParseUUIDPipe) syncId: string) {
    return this.syncJobService.getStatus(syncId);
  }

  /** Lista productos guardados en Supabase. */
  @Get()
  list(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.publicationsService.list(Number(page), Number(limit));
  }

  /** Obtiene el detalle por UUID interno. */
  @Get('detalle/:productId')
  findOne(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.publicationsService.findOne(productId);
  }

  /** Procesa un bloque automático y encadena otra invocación. */
  private async processAutomaticBatch(syncId: string): Promise<void> {
    let hasMore: boolean;

    try {
      const result = await this.syncJobService.processNext(syncId);
      hasMore = result.hasMore;
    } catch (error) {
      await this.handleInternalFailure(syncId, error);
      return;
    }

    if (hasMore) {
      await this.syncDispatcher.dispatchNext(syncId);
    }
  }

  /** Reagenda solamente los errores que dejaron el job pendiente. */
  private async handleInternalFailure(
    syncId: string,
    error: unknown,
  ): Promise<void> {
    const status = await this.syncJobService.getStatus(syncId);

    if (status.status === 'PENDING') {
      await this.syncDispatcher.dispatchNext(syncId);
    }

    if (status.status === 'FAILED') {
      throw error;
    }
  }
}
