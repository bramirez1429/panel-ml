import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Redirect,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { MercadolibreService } from './mercadolibre.service';
import { UpdatePriceDto } from './update-price.dto';

@Controller('mercadolibre')
export class MercadolibreController {
  /** Recibe el servicio que contiene la integración. */
  constructor(private readonly mercadolibreService: MercadolibreService) {}

  /** Redirige al usuario para autorizar la cuenta. */
  @Get('connect')
  @Redirect()
  connect(): { url: string } {
    return { url: this.mercadolibreService.createAuthorizationUrl() };
  }

  /** Valida OAuth y guarda la conexión en Supabase. */
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

    const tokens = await this.mercadolibreService.exchangeCode(code);
    const seller = await this.mercadolibreService.getCurrentUser(
      tokens.access_token,
    );
    await this.mercadolibreService.saveTokens(seller, tokens);

    return {
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller,
    };
  }

  /** Devuelve una página de publicaciones. */
  @Get('publicaciones')
  getPublications(
    @Query('limit') limit?: string,
    @Query('scrollId') scrollId?: string,
  ) {
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    return this.mercadolibreService.getPublicationsPage(
      parsedLimit,
      scrollId?.trim() || undefined,
    );
  }

  /** Devuelve una publicación completa. */
  @Get('publicaciones/:itemId')
  getPublication(@Param('itemId') itemId: string) {
    return this.mercadolibreService.getPublication(itemId);
  }

  /** Actualiza el precio de una publicación. */
  @Put('publicaciones/:itemId/precio')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  updatePrice(@Param('itemId') itemId: string, @Body() body: UpdatePriceDto) {
    return this.mercadolibreService.updatePublicationPrice(itemId, body.price);
  }

  /** Devuelve las condiciones de venta y precios de un User Product. */
  @Get('user-products/:userProductId/precios')
  getUserProductPrices(@Param('userProductId') userProductId: string) {
    return this.mercadolibreService.getUserProductPrices(userProductId);
  }

  /** Confirma rápidamente la recepción del webhook. */
  @Post('webhook')
  @HttpCode(200)
  webhook(): { ok: true } {
    return { ok: true };
  }
}
