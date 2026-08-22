import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { SupabaseService } from '../database/supabase.service';
import { AuthService } from './application/auth.service';
import { AccessTokenProvider } from './application/ports/access-token-provider.port';
import { AuthConfiguration } from './application/ports/auth-configuration.port';
import { PasswordHasher } from './application/ports/password-hasher.port';
import { RefreshSessionRepository } from './application/ports/refresh-session-repository.port';
import { UserRepository } from './application/ports/user-repository.port';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { EnvironmentAuthConfiguration } from './infrastructure/environment-auth.configuration';
import { JoseAccessTokenProvider } from './infrastructure/jose-access-token.provider';
import { SupabaseRefreshSessionRepository } from './infrastructure/supabase-refresh-session.repository';
import { SupabaseUserRepository } from './infrastructure/supabase-user.repository';
import { AccessTokenGuard } from './presentation/access-token.guard';
import { AuthController } from './presentation/auth.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5, blockDuration: 60_000 }]),
  ],
  controllers: [AuthController],
  providers: [
    SupabaseService,
    AuthService,
    AccessTokenGuard,
    { provide: UserRepository, useClass: SupabaseUserRepository },
    {
      provide: RefreshSessionRepository,
      useClass: SupabaseRefreshSessionRepository,
    },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    {
      provide: AuthConfiguration,
      useClass: EnvironmentAuthConfiguration,
    },
    { provide: AccessTokenProvider, useClass: JoseAccessTokenProvider },
  ],
  exports: [AuthService, AccessTokenGuard],
})
export class AuthModule {}
