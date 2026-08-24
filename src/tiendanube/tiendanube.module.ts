import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { TiendanubeApiService } from './shared/tiendanube-api.service';
import { TiendanubeController } from './tiendanube.controller';

@Module({
  imports: [ConfigModule],
  controllers: [TiendanubeController],
  providers: [TiendanubeApiService],
  exports: [TiendanubeApiService],
})
export class TiendanubeModule {}
