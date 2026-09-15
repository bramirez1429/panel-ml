import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { UsersService } from '../application/users.service';
import { AdminGuard } from './admin.guard';
import {
  CreateManagedUserDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/user-management.dto';

@Controller('users')
@UseGuards(AccessTokenGuard, AdminGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
  ) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(
    @CurrentUser() actor: SafeUser,
    @Body() input: CreateManagedUserDto,
  ) {
    return this.users.create(actor.id, input);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() actor: SafeUser,
    @Param('id') userId: string,
    @Body() input: UpdateUserStatusDto,
  ) {
    return this.users.setStatus(
      actor.id,
      userId,
      input.isActive,
    );
  }

  @Patch(':id/role')
  updateRole(
    @CurrentUser() actor: SafeUser,
    @Param('id') userId: string,
    @Body() input: UpdateUserRoleDto,
  ) {
    return this.users.setRole(
      actor.id,
      userId,
      input.role,
    );
  }
}

