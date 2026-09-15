import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { MercadolibreModule } from './mercadolibre/mercadolibre.module';
import { TiendanubeModule } from './tiendanube/tiendanube.module';
import { SalesModule } from './sales/sales.module';

import { UsersModule } from './users/users.module';

@Module({
  imports: [
    UsersModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    MercadolibreModule,
    TiendanubeModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
