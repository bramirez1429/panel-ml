import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { SupabaseService } from '../database/supabase.service';
import { AuthService } from './application/auth.service';
import { PasswordHasher } from './application/ports/password-hasher.port';
import { SessionRepository } from './application/ports/session-repository.port';
import { UserRepository } from './application/ports/user-repository.port';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { SupabaseSessionRepository } from './infrastructure/supabase-session.repository';
import { SupabaseUserRepository } from './infrastructure/supabase-user.repository';
import { AuthController } from './presentation/auth.controller';
import { SessionAuthGuard } from './presentation/session-auth.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5, blockDuration: 60_000 }]),
  ],
  controllers: [AuthController],
  providers: [
    SupabaseService,
    AuthService,
    SessionAuthGuard,
    { provide: UserRepository, useClass: SupabaseUserRepository },
    { provide: SessionRepository, useClass: SupabaseSessionRepository },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
  ],
  exports: [SessionAuthGuard],
})
export class AuthModule {}
