import {
  BadRequestException, Controller, Get, Header, Query, UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/domain/auth.models';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import { TiendaNegocioCatalogService } from './catalog/tiendanegocio-catalog.service';

@Controller('tienda-negocio/sincronizacion')
@UseGuards(AccessTokenGuard)
export class TiendaNegocioController {
  constructor(private readonly catalog: TiendaNegocioCatalogService) {}

  @Get('catalogo')
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: SafeUser,
    @Query('cursor') cursor?: string,
  ) {
    if (cursor && cursor.length > 2048) {
      throw new BadRequestException('Cursor de Mercado Libre inválido');
    }
    return this.catalog.getPage(user.id, cursor ?? null);
  }

  @Get('estado')
  @Header('Cache-Control', 'no-store')
  status() {
    return {
      connected: false,
      migrationEnabled: false,
      stage: 'OAUTH_SETUP_REQUIRED',
      documentation: 'https://docs.developers.tiendanegocio.com/docs/app',
    };
  }
}
