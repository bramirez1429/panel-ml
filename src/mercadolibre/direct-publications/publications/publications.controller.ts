import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';

import { PublicationsService } from './publications.service';

@Controller('mercadolibre/direct/publicaciones')
export class PublicationsController {
  constructor(
    private readonly service: PublicationsService,
  ) {}

  /** Listado agrupado para el frontend. */
  @Get('agrupadas')
  getGrouped(
    @Query('limit') limit = '20',
    @Query('cursor') cursor?: string,
  ) {
    return this.service.getGrouped(
      Number(limit),
      cursor,
    );
  }

  /** Listado directo sin agrupar. */
  @Get()
  getPage(
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ) {
    return this.service.getPage(
      Number(limit),
      Number(offset),
    );
  }
}