import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database/database.types';
import type { SupabaseService } from '../../database/supabase.service';
import type { CreateUserInput } from '../application/ports/user-repository.port';
import { EmailAlreadyExistsError } from '../domain/auth.errors';
import { SupabaseUserRepository } from './supabase-user.repository';

type UserRow = Database['public']['Tables']['users']['Row'];

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2026-08-21T12:00:00.000Z';
const UPDATED_AT = '2026-08-21T13:00:00.000Z';
const INPUT: CreateUserInput = {
  email: 'user@example.com',
  passwordHash: '$argon2id$test-hash',
  name: 'Test User',
};
const USER_ROW: UserRow = {
  id: USER_ID,
  email: INPUT.email,
  password_hash: INPUT.passwordHash,
  name: INPUT.name,
  is_active: true,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
};

/** Crea el repositorio con una tabla Supabase simulada. */
function setup(table: object) {
  const from = jest.fn().mockReturnValue(table);
  const client = { from } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;

  return { repository: new SupabaseUserRepository(supabase), from };
}

/** Simula la cadena insert().select().single(). */
function createSetup(data: UserRow | null, error: unknown = null) {
  const single = jest.fn().mockResolvedValue({ data, error });
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });

  return { ...setup({ insert }), insert, select };
}

/** Simula la cadena select().eq().maybeSingle(). */
function findSetup(data: UserRow | null, error: unknown = null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });

  return { ...setup({ select }), select, eq };
}

describe('SupabaseUserRepository', () => {
  it('crea y mapea una fila de usuario al modelo de dominio', async () => {
    const { repository, from, insert, select } = createSetup(USER_ROW);

    await expect(repository.create(INPUT)).resolves.toEqual({
      id: USER_ID,
      email: INPUT.email,
      passwordHash: INPUT.passwordHash,
      name: INPUT.name,
      isActive: true,
      createdAt: new Date(CREATED_AT),
      updatedAt: new Date(UPDATED_AT),
    });
    expect(from).toHaveBeenCalledWith('users');
    expect(insert).toHaveBeenCalledWith({
      email: INPUT.email,
      password_hash: INPUT.passwordHash,
      name: INPUT.name,
    });
    expect(select).toHaveBeenCalledWith(
      'id,email,password_hash,name,is_active,created_at,updated_at',
    );
  });

  it('busca por email y por id, y devuelve null cuando no existe', async () => {
    const byEmail = findSetup(USER_ROW);

    await expect(
      byEmail.repository.findByEmail(INPUT.email),
    ).resolves.toMatchObject({
      id: USER_ID,
      passwordHash: INPUT.passwordHash,
      createdAt: new Date(CREATED_AT),
    });
    expect(byEmail.eq).toHaveBeenCalledWith('email', INPUT.email);

    const byId = findSetup(null);
    await expect(byId.repository.findById(USER_ID)).resolves.toBeNull();
    expect(byId.eq).toHaveBeenCalledWith('id', USER_ID);
  });

  it('traduce el email duplicado al error de dominio', async () => {
    const { repository } = createSetup(null, {
      code: '23505',
      message: 'sensitive duplicate details',
    });

    await expect(repository.create(INPUT)).rejects.toBeInstanceOf(
      EmailAlreadyExistsError,
    );
  });

  it('oculta los detalles de errores de escritura', async () => {
    const { repository } = createSetup(null, {
      code: '23514',
      message: 'sensitive database details',
    });

    await expect(repository.create(INPUT)).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo guardar el usuario',
    });
  });

  it('oculta los detalles de errores de lectura', async () => {
    const { repository } = findSetup(null, {
      message: 'sensitive database details',
    });

    await expect(repository.findByEmail(INPUT.email)).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo leer el usuario',
    });
  });
});
