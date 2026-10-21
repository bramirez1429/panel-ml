import {
  BadRequestException, Body, Controller, Delete, Get, Header,
  Post, Query, UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/domain/auth.models';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import { TiendaNegocioOAuthService } from './auth/tiendanegocio-oauth.service';
import { TiendaNegocioCatalogService } from './catalog/tiendanegocio-catalog.service';
import { TiendaNegocioPreviewService } from './products/tiendanegocio-preview.service';
import { TiendaNegocioConnectionRepository } from './connections/tiendanegocio-connection.repository';

@Controller('tienda-negocio/sincronizacion')
@UseGuards(AccessTokenGuard)
export class TiendaNegocioController {
  constructor(
    private readonly catalog: TiendaNegocioCatalogService,
    private readonly preview: TiendaNegocioPreviewService,
    private readonly connections: TiendaNegocioConnectionRepository,
    private readonly oauth: TiendaNegocioOAuthService,
  ) {}

  @Get('catalogo')
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: SafeUser, @Query('cursor') cursor?: string) {
    if (cursor && cursor.length > 2048) {
      throw new BadRequestException('Cursor de Mercado Libre inválido');
    }
    return this.catalog.getPage(user.id, cursor ?? null);
  }

  @Get('vista-previa')
  @Header('Cache-Control', 'no-store')
  previewSource(
    @CurrentUser() user: SafeUser,
    @Query('sourceKey') sourceKey?: string,
  ) {
    if (!sourceKey || sourceKey.length > 150) {
      throw new BadRequestException('Publicación inválida');
    }
    return this.preview.preview(user.id, sourceKey);
  }

  @Get('estado')
  @Header('Cache-Control', 'no-store')
  async status(@CurrentUser() user: SafeUser) {
    const authorizationConfigured = this.oauth.isConfigured();
    // La UI puede mostrarse antes de crear las tablas SQL y las credenciales:
    // no necesitamos consultar la base cuando todavía falta configurar OAuth.
    const connection = authorizationConfigured
      ? await this.connections.get(user.id)
      : null;
    return {
      connected: connection !== null,
      storeId: connection?.store_id ?? null,
      authorizationConfigured,
      migrationEnabled: false,
      stage: connection
        ? 'MIGRATION_SETUP_REQUIRED'
        : authorizationConfigured ? 'AUTHORIZATION_PENDING' : 'OAUTH_SETUP_REQUIRED',
      documentation: 'https://docs.developers.tiendanegocio.com/docs/app',
    };
  }

  @Get('conexion/iniciar')
  @Header('Cache-Control', 'no-store')
  install() {
    return { url: this.oauth.getInstallationUrl() };
  }

  @Post('conexion/completar')
  @Header('Cache-Control', 'no-store')
  complete(@CurrentUser() user: SafeUser, @Body() body: unknown) {
    if (!isRecord(body) || typeof body.code !== 'string') {
      throw new BadRequestException('Código OAuth inválido');
    }
    return this.oauth.exchange(user.id, body.code);
  }

  @Delete('conexion')
  async disconnect(@CurrentUser() user: SafeUser) {
    await this.connections.disconnect(user.id);
    return { ok: true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
