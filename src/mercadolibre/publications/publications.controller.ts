import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { PublicationsService } from './publications.service';
import { PublicationSyncJobService } from './sync/publication-sync-job.service';
import { PublicationSyncQueueService } from './sync/publication-sync-queue.service';

@Controller('mercadolibre/publicaciones')
@UseGuards(AccessTokenGuard)
export class PublicationsController {
  /** Recibe consultas de publicaciones y administración de jobs. */
  constructor(
    private readonly publicationsService: PublicationsService,
    private readonly syncJobService: PublicationSyncJobService,
    private readonly syncQueue: PublicationSyncQueueService,
  ) {}

  /** Crea una sincronización y agenda su primer bloque. */
  @Post('sync')
  async startSync(@CurrentUser() user: SafeUser) {
    const result = await this.syncJobService.start(user.id);

    await this.syncQueue.enqueue(user.id, result.syncId);
    return result;
  }

  /** Procesa manualmente un único bloque para debugging. */
  @Post('sync/:syncId/next')
  processNext(
    @CurrentUser() user: SafeUser,
    @Param('syncId', ParseUUIDPipe) syncId: string,
  ) {
    return this.syncJobService.processNext(user.id, syncId);
  }

  /** Consulta el estado acumulado de una sincronización. */
  @Get('sync/:syncId')
  getSyncStatus(
    @CurrentUser() user: SafeUser,
    @Param('syncId', ParseUUIDPipe) syncId: string,
  ) {
    return this.syncJobService.getStatus(user.id, syncId);
  }

  /** Lista productos guardados en Supabase. */
  @Get()
  list(
    @CurrentUser() user: SafeUser,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.publicationsService.list(user.id, Number(page), Number(limit));
  }

  /** Obtiene el detalle por UUID interno. */
  @Get('detalle/:productId')
  findOne(
    @CurrentUser() user: SafeUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.publicationsService.findOne(user.id, productId);
  }

  /** Modifica el precio de una publicación. */
  @Patch(':productId/precio')
  updatePrice(
    @CurrentUser() user: SafeUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: { price: number; itemId?: string },
  ) {
    return this.publicationsService.updatePrice(
      user.id,
      productId,
      body.price,
      body.itemId,
    );
  }

  /** Modifica el stock de una publicación. */
  @Patch(':productId/stock')
  updateStock(
    @CurrentUser() user: SafeUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body()
    body: {
      stock: number;
      itemId?: string;
      variationId?: number;
    },
  ) {
    return this.publicationsService.updateStock(
      user.id,
      productId,
      body.stock,
      body.itemId,
      body.variationId,
    );
  }

  /** Obtiene las promociones de una publicación. */
  @Get(':productId/promociones')
  getPromotions(
    @CurrentUser() user: SafeUser,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.publicationsService.getPromotions(user.id, productId);
  }
}
