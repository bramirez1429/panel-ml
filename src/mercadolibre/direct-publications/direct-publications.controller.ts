import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { DirectPublicationsService } from './direct-publications.service';

@Controller('mercadolibre/direct/publicaciones')
export class DirectPublicationsController {
  constructor(
    private readonly directPublicationsService: DirectPublicationsService,
  ) {}

  /** Trae publicaciones directamente desde Mercado Libre. */
  @Get()
  getPublications(
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ) {
    return this.directPublicationsService.getPublications(
      Number(limit),
      Number(offset),
    );
  }
}