import { Controller, Get } from '@nestjs/common';

export type TiendanubeHealthResponse = Readonly<{
  ok: true;
  service: 'tiendanube';
}>;

@Controller('tiendanube')
export class TiendanubeController {
  @Get('health')
  health(): TiendanubeHealthResponse {
    return {
      ok: true,
      service: 'tiendanube',
    };
  }
}
