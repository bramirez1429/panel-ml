import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../database/supabase.service';
import { UsersService } from './application/users.service';
import { UserAdminRepository } from './application/ports/user-admin.repository';
import { SupabaseUserAdminRepository } from './infrastructure/supabase-user-admin.repository';
import { AdminGuard } from './presentation/admin.guard';
import { UsersController } from './presentation/users.controller';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    SupabaseService,
    UsersService,
    AdminGuard,
    {
      provide: UserAdminRepository,
      useClass: SupabaseUserAdminRepository,
    },
  ],
})
export class UsersModule {}

