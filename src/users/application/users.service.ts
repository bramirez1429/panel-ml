import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from '../../auth/application/auth.service';
import {
  canAssignRole,
  canManageUser,
  type AssignableUserRole,
} from '../domain/user-access';
import type { ManagedUser } from '../domain/user-management.models';
import { UserAdminRepository } from './ports/user-admin.repository';

type CreateInput = Readonly<{
  email: string;
  password: string;
  name?: string;
  role?: AssignableUserRole;
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UserAdminRepository,
  ) {}

  list(): Promise<ManagedUser[]> {
    return this.users.findAll();
  }

  async create(
    actorId: string,
    input: CreateInput,
  ): Promise<ManagedUser> {
    const actor = await this.requireUser(actorId);
    const role = input.role ?? 'USER';

    if (!canAssignRole(actor.role, role)) {
      throw new ForbiddenException(
        'No tenés permisos para asignar ese rol',
      );
    }

    const created = await this.auth.register({
      email: input.email,
      password: input.password,
      name: input.name,
    });

    if (role === 'ADMIN') {
      const promoted = await this.users.updateRole(
        created.id,
        'ADMIN',
      );

      if (promoted) return promoted;
    }

    return this.requireUser(created.id);
  }

  async setStatus(
    actorId: string,
    userId: string,
    isActive: boolean,
  ): Promise<ManagedUser> {
    const [actor, target] = await Promise.all([
      this.requireUser(actorId),
      this.requireUser(userId),
    ]);

    if (actorId === userId && !isActive) {
      throw new BadRequestException(
        'No podés desactivar tu propio usuario',
      );
    }

    if (!canManageUser(actor.role, target.role)) {
      throw new ForbiddenException(
        'No tenés permisos para modificar este usuario',
      );
    }

    const updated = await this.users.updateActive(
      userId,
      isActive,
    );

    if (!updated) throw new NotFoundException('Usuario no encontrado');

    return updated;
  }

  async setRole(
    actorId: string,
    userId: string,
    role: AssignableUserRole,
  ): Promise<ManagedUser> {
    const [actor, target] = await Promise.all([
      this.requireUser(actorId),
      this.requireUser(userId),
    ]);

    if (!canManageUser(actor.role, target.role)) {
      throw new ForbiddenException(
        'No tenés permisos para modificar este usuario',
      );
    }

    if (!canAssignRole(actor.role, role)) {
      throw new ForbiddenException(
        'No tenés permisos para asignar ese rol',
      );
    }

    const updated = await this.users.updateRole(
      userId,
      role,
    );

    if (!updated) throw new NotFoundException('Usuario no encontrado');

    return updated;
  }

  private async requireUser(id: string): Promise<ManagedUser> {
    const user = await this.users.findById(id);

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }
}

