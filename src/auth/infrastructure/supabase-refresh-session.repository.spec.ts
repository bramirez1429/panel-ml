import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database/database.types';
import type { SupabaseService } from '../../database/supabase.service';
import { SupabaseRefreshSessionRepository } from './supabase-refresh-session.repository';

type RefreshSessionMetadataRow =
  Database['public']['Functions']['rotate_user_refresh_session']['Returns'][number];

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2026-08-21T12:00:00.000Z';
const ROTATED_AT = '2026-08-21T13:00:00.000Z';
const EXPIRES_AT = '2026-08-22T12:00:00.000Z';
const REVOKED_AT = '2026-08-21T14:00:00.000Z';
const CURRENT_REFRESH_TOKEN_HASH = 'a'.repeat(64);
const NEXT_REFRESH_TOKEN_HASH = 'b'.repeat(64);
const INPUT = {
  userId: USER_ID,
  refreshTokenHash: CURRENT_REFRESH_TOKEN_HASH,
  sessionTtlMs: 86_400_000,
};
const SESSION_ROW: RefreshSessionMetadataRow = {
  id: SESSION_ID,
  user_id: USER_ID,
  expires_at: EXPIRES_AT,
  revoked_at: null,
  created_at: CREATED_AT,
  rotated_at: CREATED_AT,
};
const ROTATED_SESSION_ROW: RefreshSessionMetadataRow = {
  id: SESSION_ID,
  user_id: USER_ID,
  expires_at: EXPIRES_AT,
  revoked_at: null,
  created_at: CREATED_AT,
  rotated_at: ROTATED_AT,
};

function setupTable(table: object) {
  const from = jest.fn().mockReturnValue(table);
  const client = { from } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;

  return {
    repository: new SupabaseRefreshSessionRepository(supabase),
    from,
  };
}

function rpcSetup(
  data: RefreshSessionMetadataRow[] | null,
  error: unknown = null,
) {
  const rpc = jest.fn().mockResolvedValue({ data, error });
  const client = { rpc } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;

  return {
    repository: new SupabaseRefreshSessionRepository(supabase),
    rpc,
  };
}

function revokeSetup(error: unknown = null) {
  const is = jest.fn().mockResolvedValue({ error });
  const eq = jest.fn().mockReturnValue({ is });
  const update = jest.fn().mockReturnValue({ eq });

  return { ...setupTable({ update }), update, eq, is };
}

describe('SupabaseRefreshSessionRepository', () => {
  it('crea la sesi\u00f3n guardando s\u00f3lo el hash y devuelve metadata', async () => {
    const { repository, rpc } = rpcSetup([SESSION_ROW]);

    const result = await repository.create(INPUT);

    expect(result).toEqual({
      id: SESSION_ID,
      userId: USER_ID,
      expiresAt: new Date(EXPIRES_AT),
      revokedAt: null,
      createdAt: new Date(CREATED_AT),
      rotatedAt: new Date(CREATED_AT),
    });
    expect(result).not.toHaveProperty('refreshTokenHash');
    expect(rpc).toHaveBeenCalledWith('create_user_refresh_session', {
      p_user_id: USER_ID,
      p_refresh_token_hash: CURRENT_REFRESH_TOKEN_HASH,
      p_ttl_milliseconds: 86_400_000,
    });
  });

  it('rota el refresh de forma at\u00f3mica mediante el RPC', async () => {
    const { repository, rpc } = rpcSetup([ROTATED_SESSION_ROW]);

    const result = await repository.rotate({
      currentRefreshTokenHash: CURRENT_REFRESH_TOKEN_HASH,
      nextRefreshTokenHash: NEXT_REFRESH_TOKEN_HASH,
    });

    expect(result).toEqual({
      id: SESSION_ID,
      userId: USER_ID,
      expiresAt: new Date(EXPIRES_AT),
      revokedAt: null,
      createdAt: new Date(CREATED_AT),
      rotatedAt: new Date(ROTATED_AT),
    });
    expect(result).not.toHaveProperty('refreshTokenHash');
    expect(rpc).toHaveBeenCalledWith('rotate_user_refresh_session', {
      p_current_refresh_token_hash: CURRENT_REFRESH_TOKEN_HASH,
      p_next_refresh_token_hash: NEXT_REFRESH_TOKEN_HASH,
    });
  });

  it('devuelve null cuando el refresh ya no se puede rotar', async () => {
    const { repository } = rpcSetup([]);

    await expect(
      repository.rotate({
        currentRefreshTokenHash: CURRENT_REFRESH_TOKEN_HASH,
        nextRefreshTokenHash: NEXT_REFRESH_TOKEN_HASH,
      }),
    ).resolves.toBeNull();
  });

  it('revoca solamente una sesi\u00f3n que sigue activa', async () => {
    const { repository, update, eq, is } = revokeSetup();
    const revokedAt = new Date(REVOKED_AT);

    await expect(
      repository.revoke(SESSION_ID, revokedAt),
    ).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({ revoked_at: REVOKED_AT });
    expect(eq).toHaveBeenCalledWith('id', SESSION_ID);
    expect(is).toHaveBeenCalledWith('revoked_at', null);
  });

  it('oculta detalles de errores al crear una sesi\u00f3n', async () => {
    const { repository } = rpcSetup(null, {
      message: 'sensitive database details',
    });

    await expect(repository.create(INPUT)).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo guardar la sesi\u00f3n de refresh',
    });
  });

  it('oculta detalles de errores al rotar una sesi\u00f3n', async () => {
    const { repository } = rpcSetup(null, {
      message: 'sensitive database details',
    });

    await expect(
      repository.rotate({
        currentRefreshTokenHash: CURRENT_REFRESH_TOKEN_HASH,
        nextRefreshTokenHash: NEXT_REFRESH_TOKEN_HASH,
      }),
    ).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo guardar la sesi\u00f3n de refresh',
    });
  });

  it('oculta detalles de errores al revocar una sesi\u00f3n', async () => {
    const { repository } = revokeSetup({
      message: 'sensitive database details',
    });

    await expect(
      repository.revoke(SESSION_ID, new Date(REVOKED_AT)),
    ).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo guardar la sesi\u00f3n de refresh',
    });
  });
});
