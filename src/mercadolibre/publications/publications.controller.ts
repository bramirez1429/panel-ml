import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Patch,
  Body,
} from '@nestjs/common';
import { PublicationsService } from './publications.service';
import { PublicationSyncJobService } from './sync/publication-sync-job.service';
import { PublicationSyncQueueService } from './sync/publication-sync-queue.service';

@Controller('mercadolibre/publicaciones')
export class PublicationsController {
  /** Recibe consultas de publicaciones y administración de jobs. */
  constructor(
    private readonly publicationsService: PublicationsService,
    private readonly syncJobService: PublicationSyncJobService,
    private readonly syncQueue: PublicationSyncQueueService,
  ) {}

  /** Crea una sincronización y agenda su primer bloque. */
  @Post('sync')
  async startSync() {
    const result = await this.syncJobService.start();

    await this.syncQueue.enqueue(result.syncId);
    return result;
  }

  /** Procesa manualmente un único bloque para debugging. */
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

    /** Modifica el precio de una publicación. */
  @Patch(':productId/precio')
  updatePrice(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: { price: number; itemId?: string },
  ) {
    return this.publicationsService.updatePrice(
      productId,
      body.price,
      body.itemId,
    );
  }

  /** Modifica el stock de una publicación. */
@Patch(':productId/stock')
updateStock(
  @Param('productId', ParseUUIDPipe) productId: string,
  @Body()
  body: {
    stock: number;
    itemId?: string;
    variationId?: number;
  },
) {
  return this.publicationsService.updateStock(
    productId,
    body.stock,
    body.itemId,
    body.variationId,
  );
}

/** Obtiene las promociones de una publicación. */
@Get(':productId/promociones')
getPromotions(
  @Param('productId', ParseUUIDPipe) productId: string,
  @Query('itemId') itemId?: string,
) {
  return this.publicationsService.getPromotions(
    productId,
    itemId,
  );
}
}
