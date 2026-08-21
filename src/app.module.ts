import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { MercadolibreModule } from './mercadolibre/mercadolibre.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    MercadolibreModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
