import type {
  ManagedUser,
  UserRole,
} from '../../domain/user-management.models';

export abstract class UserAdminRepository {
  abstract findAll(): Promise<ManagedUser[]>;
  abstract findById(id: string): Promise<ManagedUser | null>;
  abstract updateActive(
    id: string,
    isActive: boolean,
  ): Promise<ManagedUser | null>;
  abstract updateRole(
    id: string,
    role: UserRole,
  ): Promise<ManagedUser | null>;
}

