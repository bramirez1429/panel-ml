import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { TiendanubeOAuthService } from './auth/tiendanube-oauth.service';
import { TiendanubeApiService } from './shared/tiendanube-api.service';
import { TiendanubeController } from './tiendanube.controller';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [TiendanubeController],
  providers: [TiendanubeApiService, TiendanubeOAuthService],
  exports: [TiendanubeApiService],
})
export class TiendanubeModule {}
