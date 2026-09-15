import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import type { Database } from '../../database/database.types';
import { UserAdminRepository } from '../application/ports/user-admin.repository';
import type {
  ManagedUser,
  UserRole,
} from '../domain/user-management.models';

type UserRow = Database['public']['Tables']['users']['Row'];
type UserUpdate = Partial<
  Database['public']['Tables']['users']['Insert']
>;

const COLUMNS =
  'id,email,name,is_active,role,created_at,updated_at';

@Injectable()
export class SupabaseUserAdminRepository extends UserAdminRepository {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async findAll(): Promise<ManagedUser[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .select(COLUMNS)
      .order('created_at', { ascending: false });

    if (error) this.readError();

    return (data ?? []).map((row) => this.map(row as UserRow));
  }

  async findById(id: string): Promise<ManagedUser | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) this.readError();

    return data ? this.map(data as UserRow) : null;
  }

  async updateActive(
    id: string,
    isActive: boolean,
  ): Promise<ManagedUser | null> {
    return this.update(id, {
      is_active: isActive,
      updated_at: new Date().toISOString(),
    });
  }

  async updateRole(
    id: string,
    role: UserRole,
  ): Promise<ManagedUser | null> {
    return this.update(id, {
      role,
      updated_at: new Date().toISOString(),
    });
  }

  private async update(
    id: string,
    changes: UserUpdate,
  ): Promise<ManagedUser | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('users')
      .update(changes)
      .eq('id', id)
      .select(COLUMNS)
      .maybeSingle();

    if (error) this.writeError();

    return data ? this.map(data as UserRow) : null;
  }

  private map(row: UserRow): ManagedUser {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      isActive: row.is_active,
      role: row.role,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudieron leer los usuarios',
    );
  }

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo actualizar el usuario',
    );
  }
}

