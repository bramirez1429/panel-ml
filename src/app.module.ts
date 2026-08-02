import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MercadolibreModule } from './mercadolibre/mercadolibre.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), MercadolibreModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
