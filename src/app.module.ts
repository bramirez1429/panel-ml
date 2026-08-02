import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MercadolibreModule } from './mercadolibre/mercadolibre.module';

@Module({
  imports: [MercadolibreModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
