import { Controller, Get, Param, Query } from '@nestjs/common';

import { PublicationsService } from './publications.service';
import { PublicationDetailService } from './publication-detail.service';

@Controller('mercadolibre/direct/publicaciones')
export class PublicationsController {
  constructor(
    private readonly service: PublicationsService,
    private readonly detailService: PublicationDetailService,
  ) {}

  /** Listado agrupado para el frontend. */
  @Get('agrupadas')
  getGrouped(@Query('limit') limit = '20', @Query('cursor') cursor?: string) {
    return this.service.getGrouped(Number(limit), cursor);
  }

  /** Detalle de una sola publicación MLA. */
  @Get(':itemId')
  getDetail(@Param('itemId') itemId: string) {
    return this.detailService.getDetail(itemId);
  }

  /** Listado directo sin agrupar. */
  @Get()
  getPage(@Query('limit') limit = '20', @Query('offset') offset = '0') {
    return this.service.getPage(Number(limit), Number(offset));
  }
}
