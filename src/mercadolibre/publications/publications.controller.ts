import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PublicationsService } from './publications.service';
import { PublicationSyncService } from './sync/publication-sync.service';

@Controller('mercadolibre/publicaciones')
export class PublicationsController {
  constructor(
    private readonly publicationsService: PublicationsService,
    private readonly publicationSyncService: PublicationSyncService,
  ) {}

  /** Sincroniza todas las publicaciones desde Mercado Libre. */
  @Post('sync')
  syncAll() {
    return this.publicationSyncService.syncAll();
  }

  /** Lista productos guardados en Supabase. */
  @Get()
  list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.publicationsService.list(
      Number(page),
      Number(limit),
    );
  }

  /** Obtiene el detalle por UUID interno. */
  @Get('detalle/:productId')
  findOne(
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.publicationsService.findOne(productId);
  }
}