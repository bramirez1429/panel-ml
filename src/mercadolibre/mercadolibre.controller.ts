import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Redirect,
  UnauthorizedException,
} from '@nestjs/common';
import { MercadolibreService } from './mercadolibre.service';

@Controller('mercadolibre')
export class MercadolibreController {
  constructor(private readonly mercadolibreService: MercadolibreService) {}

  @Get('connect')
  @Redirect()
  connect(): { url: string } {
    return { url: this.mercadolibreService.createAuthorizationUrl() };
  }

  @Get('callback')
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    if (!state || !this.mercadolibreService.verifyState(state)) {
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

    const accessToken = await this.mercadolibreService.exchangeCode(code);
    const seller = await this.mercadolibreService.getCurrentUser(accessToken);

    return {
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller,
    };
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(): { ok: true } {
    return { ok: true };
  }
}
