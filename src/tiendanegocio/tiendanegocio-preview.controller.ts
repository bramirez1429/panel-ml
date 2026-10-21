import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import type { SafeUser } from '../auth/domain/auth.models';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import { TiendaNegocioPreviewService } from './tiendanegocio-preview.service';

@Controller('tiendanegocio/replication')
@UseGuards(AccessTokenGuard)
export class TiendaNegocioPreviewController {
  constructor(private readonly previewService: TiendaNegocioPreviewService) {}

  /** Solo lectura: no crea ni altera productos en ningún canal. */
  @Get('preview-by-source')
  @Header('Cache-Control', 'no-store')
  preview(@CurrentUser() user: SafeUser, @Query('sourceKey') sourceKey: string) {
    return this.previewService.preview(user.id, sourceKey);
  }
}
