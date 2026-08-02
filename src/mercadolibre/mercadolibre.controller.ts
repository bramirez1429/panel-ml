import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';

@Controller('mercadolibre')
export class MercadolibreController {
  @Get('callback')
  callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    return {
      ok: true,
      message: 'Callback de Mercado Libre funcionando',
      codeReceived: Boolean(code),
      state,
    };
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(@Body() body: unknown) {
    console.log('Notificación de Mercado Libre:', body);

    return { ok: true };
  }
}