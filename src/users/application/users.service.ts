import { hash } from 'argon2';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from '../../auth/application/auth.service';
import { WorkspaceRepository } from '../../workspaces/workspace.repository';
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
    private readonly workspaces: WorkspaceRepository,
  ) {}

  list(): Promise<ManagedUser[]> {
    return this.users.findAll();
  }

  async create(
    actorId: string,
    input: CreateInput,
  ): Promise<ManagedUser> {
    const actor = await this.requireUser(actorId);
    const actorWorkspace =
      await this.workspaces.findWorkspaceByUserId(actorId);
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

    await this.workspaces.addMember(
      actorWorkspace.id,
      created.id,
      'MEMBER',
    );

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

    if (
      actorId === userId &&
      actor.role === 'SUPER_ADMIN' &&
      role !== 'SUPER_ADMIN'
    ) {
      throw new BadRequestException(
        'No podés quitarte tu propio rol de super administrador',
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


  async setPassword(
    actorId: string,
    userId: string,
    password: string,
  ): Promise<void> {
    const [actor, target] = await Promise.all([
      this.requireUser(actorId),
      this.requireUser(userId),
    ]);

    if (actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Solo el super administrador puede cambiar contraseñas',
      );
    }

    if (!target.isActive) {
      throw new BadRequestException(
        'No se puede cambiar la contraseña de un usuario inactivo',
      );
    }

    const passwordHash = await hash(password);

    const updated = await this.users.updatePasswordHash(
      userId,
      passwordHash,
    );

    if (!updated) {
      throw new NotFoundException('Usuario no encontrado');
    }
  }

  private async requireUser(id: string): Promise<ManagedUser> {
    const user = await this.users.findById(id);

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }
}
