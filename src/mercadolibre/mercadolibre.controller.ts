import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Redirect,
  UnauthorizedException,
} from '@nestjs/common';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { PublicationsService } from './publications/publications.service';

@Controller('mercadolibre')
export class MercadolibreController {
  /** Recibe los servicios de autenticación y publicaciones. */
  constructor(
    private readonly authService: MercadolibreAuthService,
    private readonly publicationsService: PublicationsService,
  ) {}

  /** Redirige al usuario para autorizar la cuenta. */
  @Get('connect')
  @Redirect()
  connect(): { url: string } {
    return { url: this.authService.createAuthorizationUrl() };
  }

  /** Valida OAuth y guarda la conexión en Supabase. */
  @Get('callback')
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    if (!state || !this.authService.verifyState(state)) {
      throw new UnauthorizedException('El state es inválido o venció');
    }

    if (error || errorDescription) {
      throw new BadRequestException(
        'La autorización de Mercado Libre fue cancelada o rechazada',
      );
    }

    if (!code?.trim()) {
      throw new BadRequestException('Falta el código de autorización');
    }

    const tokens = await this.authService.exchangeCode(code);
    const seller = await this.authService.getCurrentUser(tokens.access_token);
    await this.authService.saveTokens(seller, tokens);

    return {
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller,
    };
  }

  /** Devuelve una página de productos agrupados para la tabla. */
  @Get('publicaciones')
  getPublications(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page === undefined ? 1 : Number(page);
    const parsedLimit = limit === undefined ? 20 : Number(limit);

    return this.publicationsService.getPublicationsPage(
      parsedPage,
      parsedLimit,
    );
  }

  /** Devuelve el detalle completo y seguro de un MLA. */
  @Get('publicaciones/:itemId')
  getPublication(@Param('itemId') itemId: string) {
    return this.publicationsService.getPublication(itemId);
  }

  /** Confirma rápidamente la recepción del webhook. */
  @Post('webhook')
  @HttpCode(200)
  webhook(): { ok: true } {
    return { ok: true };
  }
}
