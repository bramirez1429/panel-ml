import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { UserAdminRepository } from '../application/ports/user-admin.repository';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly users: UserAdminRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const user = await this.users.findById(request.auth.user.id);

    if (!user?.isActive || user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Se requieren permisos de administrador',
      );
    }

    return true;
  }
}

