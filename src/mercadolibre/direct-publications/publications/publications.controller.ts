import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';
import type { SafeUser } from '../../../auth/domain/auth.models';

import { PublicationsService } from './publications.service';
import { PublicationDetailService } from './publication-detail.service';

@Controller('mercadolibre/direct/publicaciones')
@UseGuards(AccessTokenGuard)
export class PublicationsController {
  constructor(
    private readonly service: PublicationsService,
    private readonly detailService: PublicationDetailService,
  ) {}

  /** Listado agrupado para el frontend. */
  @Get('agrupadas')
  getGrouped(
    @CurrentUser() user: SafeUser,
    @Query('limit') limit = '20',
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
  ) {
    return this.service.getGrouped(user.id, Number(limit), cursor, search);
  }

  /** Detalle de una sola publicación MLA. */
  @Get(':itemId')
  getDetail(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.detailService.getDetail(user.id, itemId);
  }

  /** Listado directo sin agrupar. */
  @Get()
  getPage(
    @CurrentUser() user: SafeUser,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ) {
    return this.service.getPage(user.id, Number(limit), Number(offset));
  }
}
