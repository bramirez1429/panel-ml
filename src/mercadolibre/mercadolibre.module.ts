import { Module } from '@nestjs/common';
import { MercadolibreController } from './mercadolibre.controller';
import { MercadolibreService } from './mercadolibre.service';

@Module({
  controllers: [MercadolibreController],
  providers: [MercadolibreService],
})
export class MercadolibreModule {}
