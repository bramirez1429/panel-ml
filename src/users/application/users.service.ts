import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from '../../auth/application/auth.service';
import { UserAdminRepository } from './ports/user-admin.repository';
import type {
  ManagedUser,
  UserRole,
} from '../domain/user-management.models';

type CreateInput = Readonly<{
  email: string;
  password: string;
  name?: string;
  role?: UserRole;
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

  async create(input: CreateInput): Promise<ManagedUser> {
    const created = await this.auth.register({
      email: input.email,
      password: input.password,
      name: input.name,
    });

    if (input.role === 'ADMIN') {
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
    const target = await this.requireUser(userId);

    if (target.role === 'SUPER_ADMIN' && !isActive) {
      throw new BadRequestException(
        'No se puede desactivar al super administrador',
      );
    }

    if (actorId === userId && !isActive) {
      throw new BadRequestException(
        'No podés desactivar tu propio usuario',
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
    role: UserRole,
  ): Promise<ManagedUser> {
    const target = await this.requireUser(userId);

    if (
      target.role === 'SUPER_ADMIN' &&
      role !== 'SUPER_ADMIN'
    ) {
      throw new BadRequestException(
        'No se puede modificar el rol del super administrador',
      );
    }

    if (actorId === userId && role !== 'SUPER_ADMIN') {
      throw new BadRequestException(
        'No podés quitarte tu propio rol de super administrador',
      );
    }

    const updated = await this.users.updateRole(userId, role);

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

