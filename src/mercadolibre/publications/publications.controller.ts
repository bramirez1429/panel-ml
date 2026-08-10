import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PublicationSyncService } from './sync/publication-sync.service';
import { PublicationsService } from './publications.service';

@Controller('mercadolibre/publicaciones')
export class PublicationsController {
  /** Recibe los servicios de lectura y sincronización. */
  constructor(
    private readonly publicationsService: PublicationsService,
    private readonly syncService: PublicationSyncService,
  ) {}

  /** Lista productos guardados en Supabase. */
  @Get()
  list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.publicationsService.list(
      page === undefined ? 1 : Number(page),
      limit === undefined ? 20 : Number(limit),
    );
  }

  /** Ejecuta manualmente una sincronización completa. */
  @Post('sync')
  sync() {
    return this.syncService.syncAll();
  }

  /** Devuelve un producto y su detalle guardado. */
  @Get(':productId')
  findOne(@Param('productId') productId: string) {
    return this.publicationsService.findOne(productId);
  }
}
