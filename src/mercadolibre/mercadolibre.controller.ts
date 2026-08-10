import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Redirect,
  UnauthorizedException,
} from '@nestjs/common';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';

@Controller('mercadolibre')
export class MercadolibreController {
  /** Recibe el servicio de autenticación. */
  constructor(private readonly authService: MercadolibreAuthService) {}

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
}
