import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database/database.types';
import type { SupabaseService } from '../../database/supabase.service';
import type { CreateSessionInput } from '../application/ports/session-repository.port';
import { SupabaseSessionRepository } from './supabase-session.repository';

type SessionRow = Database['public']['Tables']['user_sessions']['Row'];

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2026-08-21T12:00:00.000Z';
const EXPIRES_AT = '2026-08-22T12:00:00.000Z';
const REVOKED_AT = '2026-08-21T13:00:00.000Z';
const TOKEN_HASH = 'a'.repeat(64);
const INPUT: CreateSessionInput = {
  userId: USER_ID,
  tokenHash: TOKEN_HASH,
  createdAt: new Date(CREATED_AT),
  expiresAt: new Date(EXPIRES_AT),
};
const SESSION_ROW: SessionRow = {
  id: SESSION_ID,
  user_id: USER_ID,
  token_hash: TOKEN_HASH,
  expires_at: EXPIRES_AT,
  revoked_at: null,
  created_at: CREATED_AT,
};

/** Crea el repositorio con una tabla Supabase simulada. */
function setup(table: object) {
  const from = jest.fn().mockReturnValue(table);
  const client = { from } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;

  return { repository: new SupabaseSessionRepository(supabase), from };
}

/** Simula la cadena insert().select().single(). */
function createSetup(data: SessionRow | null, error: unknown = null) {
  const single = jest.fn().mockResolvedValue({ data, error });
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });

  return { ...setup({ insert }), insert, select };
}

/** Simula la cadena select().eq().maybeSingle(). */
function findSetup(data: SessionRow | null, error: unknown = null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });

  return { ...setup({ select }), select, eq };
}

/** Simula la actualizacion condicional usada al revocar. */
function revokeSetup(error: unknown = null) {
  const is = jest.fn().mockResolvedValue({ error });
  const eq = jest.fn().mockReturnValue({ is });
  const update = jest.fn().mockReturnValue({ eq });

  return { ...setup({ update }), update, eq, is };
}

describe('SupabaseSessionRepository', () => {
  it('crea y mapea una fila de sesion al modelo de dominio', async () => {
    const { repository, from, insert, select } = createSetup(SESSION_ROW);

    await expect(repository.create(INPUT)).resolves.toEqual({
      id: SESSION_ID,
      userId: USER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: new Date(EXPIRES_AT),
      revokedAt: null,
      createdAt: new Date(CREATED_AT),
    });
    expect(from).toHaveBeenCalledWith('user_sessions');
    expect(insert).toHaveBeenCalledWith({
      user_id: USER_ID,
      token_hash: TOKEN_HASH,
      expires_at: EXPIRES_AT,
      created_at: CREATED_AT,
    });
    expect(select).toHaveBeenCalledWith(
      'id,user_id,token_hash,expires_at,revoked_at,created_at',
    );
  });

  it('busca por hash y mapea la fecha de revocacion', async () => {
    const row = { ...SESSION_ROW, revoked_at: REVOKED_AT };
    const { repository, eq } = findSetup(row);

    await expect(repository.findByTokenHash(TOKEN_HASH)).resolves.toMatchObject(
      {
        id: SESSION_ID,
        revokedAt: new Date(REVOKED_AT),
        expiresAt: new Date(EXPIRES_AT),
      },
    );
    expect(eq).toHaveBeenCalledWith('token_hash', TOKEN_HASH);
  });

  it('devuelve null cuando el hash no pertenece a una sesion', async () => {
    const { repository } = findSetup(null);

    await expect(repository.findByTokenHash(TOKEN_HASH)).resolves.toBeNull();
  });

  it('revoca solamente una sesion que sigue activa', async () => {
    const { repository, update, eq, is } = revokeSetup();
    const revokedAt = new Date(REVOKED_AT);

    await expect(
      repository.revoke(SESSION_ID, revokedAt),
    ).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({ revoked_at: REVOKED_AT });
    expect(eq).toHaveBeenCalledWith('id', SESSION_ID);
    expect(is).toHaveBeenCalledWith('revoked_at', null);
  });

  it('oculta los detalles de errores al crear una sesion', async () => {
    const { repository } = createSetup(null, {
      message: 'sensitive database details',
    });

    await expect(repository.create(INPUT)).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo guardar la sesi\u00f3n',
    });
  });

  it('oculta los detalles de errores de lectura', async () => {
    const { repository } = findSetup(null, {
      message: 'sensitive database details',
    });

    await expect(repository.findByTokenHash(TOKEN_HASH)).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo leer la sesi\u00f3n',
    });
  });

  it('oculta los detalles de errores al revocar una sesion', async () => {
    const { repository } = revokeSetup({
      message: 'sensitive database details',
    });

    await expect(
      repository.revoke(SESSION_ID, new Date(REVOKED_AT)),
    ).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo guardar la sesi\u00f3n',
    });
  });
});
