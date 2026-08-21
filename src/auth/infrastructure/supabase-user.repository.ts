import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { Database } from '../../database/database.types';
import {
  CreateUserInput,
  UserRepository,
} from '../application/ports/user-repository.port';
import { EmailAlreadyExistsError } from '../domain/auth.errors';
import { User } from '../domain/auth.models';

type UserRow = Database['public']['Tables']['users']['Row'];

const USER_COLUMNS =
  'id,email,password_hash,name,is_active,created_at,updated_at';

@Injectable()
export class SupabaseUserRepository extends UserRepository {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async create(input: CreateUserInput): Promise<User> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('users')
      .insert({
        email: input.email,
        password_hash: input.passwordHash,
        name: input.name,
      })
      .select(USER_COLUMNS)
      .single();

    if (error?.code === '23505') throw new EmailAlreadyExistsError();
    if (error || !data) this.writeError();
    return this.mapUser(data);
  }

  async findByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('users')
      .select(USER_COLUMNS)
      .eq('email', email)
      .maybeSingle();

    if (error) this.readError();
    return data ? this.mapUser(data) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('users')
      .select(USER_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) this.readError();
    return data ? this.mapUser(data) : null;
  }

  private mapUser(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      name: row.name,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private readError(): never {
    throw new ServiceUnavailableException('No se pudo leer el usuario');
  }

  private writeError(): never {
    throw new ServiceUnavailableException('No se pudo guardar el usuario');
  }
}
