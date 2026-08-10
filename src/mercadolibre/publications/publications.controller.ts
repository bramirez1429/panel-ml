import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PublicationsService } from './publications.service';
import { PublicationSyncJobService } from './sync/publication-sync-job.service';

@Controller('mercadolibre/publicaciones')
export class PublicationsController {
  /** Recibe consultas de publicaciones y administración de jobs. */
  constructor(
    private readonly publicationsService: PublicationsService,
    private readonly syncJobService: PublicationSyncJobService,
  ) {}

  /** Crea una sincronización sin iniciar el scan. */
  @Post('sync')
  startSync() {
    return this.syncJobService.start();
  }

  /** Procesa el siguiente bloque de una sincronización. */
  @Post('sync/:syncId/next')
  processNext(@Param('syncId', ParseUUIDPipe) syncId: string) {
    return this.syncJobService.processNext(syncId);
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
}
