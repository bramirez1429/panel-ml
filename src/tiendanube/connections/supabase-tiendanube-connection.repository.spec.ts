import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../database/database.types';
import type { SupabaseService } from '../../database/supabase.service';
import { SupabaseTiendanubeConnectionRepository } from './supabase-tiendanube-connection.repository';
import type { SaveTiendanubeConnectionInput } from './tiendanube-connection.repository';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCESS_TOKEN = 'private-access-token';
const NOW = '2026-08-24T15:00:00.000Z';
const INPUT: SaveTiendanubeConnectionInput = {
  userId: USER_ID,
  storeId: '987654',
  accessToken: ACCESS_TOKEN,
  tokenType: 'bearer',
  scope: 'read_products',
};

function setupRepository(error: unknown = null) {
  const upsert = jest.fn().mockResolvedValue({ data: null, error });
  const from = jest.fn().mockReturnValue({ upsert });
  const client = { from } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;

  return {
    repository: new SupabaseTiendanubeConnectionRepository(supabase),
    from,
    upsert,
  };
}

function setupReadRepository(data: unknown, error: unknown = null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;

  return {
    repository: new SupabaseTiendanubeConnectionRepository(supabase),
    from,
    select,
    eq,
    maybeSingle,
  };
}

function setupDeleteRepository(error: unknown = null) {
  const eq = jest.fn().mockResolvedValue({ data: null, error });
  const remove = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ delete: remove });
  const client = { from } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;

  return {
    repository: new SupabaseTiendanubeConnectionRepository(supabase),
    from,
    remove,
    eq,
  };
}

describe('SupabaseTiendanubeConnectionRepository', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('guarda la conexión mediante upsert único por user_id', async () => {
    const { repository, from, upsert } = setupRepository();

    await expect(repository.saveConnection(INPUT)).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledWith('tiendanube_connections');
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: USER_ID,
        store_id: '987654',
        access_token: ACCESS_TOKEN,
        token_type: 'bearer',
        scope: 'read_products',
        updated_at: NOW,
      },
      { onConflict: 'user_id', defaultToNull: false },
    );
  });

  it('reconectar el mismo usuario actualiza la fila en vez de duplicarla', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const upsert = jest.fn(
      (
        row: Record<string, unknown>,
        options: { onConflict: string; defaultToNull: boolean },
      ) => {
        if (options.onConflict === 'user_id') {
          const userId = String(row.user_id);
          rows.set(userId, { ...rows.get(userId), ...row });
        }
        return Promise.resolve({ data: null, error: null });
      },
    );
    const from = jest.fn().mockReturnValue({ upsert });
    const client = { from } as unknown as SupabaseClient<Database>;
    const supabase = {
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as SupabaseService;
    const repository = new SupabaseTiendanubeConnectionRepository(supabase);

    await repository.saveConnection(INPUT);
    jest.setSystemTime(new Date('2026-08-24T16:00:00.000Z'));
    await repository.saveConnection({
      ...INPUT,
      storeId: '123456',
      accessToken: 'replacement-access-token',
      tokenType: 'bearer',
      scope: 'write_products',
    });

    expect(rows.size).toBe(1);
    expect(rows.get(USER_ID)).toMatchObject({
      user_id: USER_ID,
      store_id: '123456',
      access_token: 'replacement-access-token',
      token_type: 'bearer',
      scope: 'write_products',
      updated_at: '2026-08-24T16:00:00.000Z',
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(expect.any(Object), {
      onConflict: 'user_id',
      defaultToNull: false,
    });
  });

  it('oculta el token y los detalles cuando Supabase falla', async () => {
    const { repository } = setupRepository({
      message: `database error containing ${ACCESS_TOKEN}`,
    });

    let caught: unknown;
    try {
      await repository.saveConnection(INPUT);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      status: 503,
      message: 'No se pudo guardar la conexión de Tiendanube',
    });
    expect(JSON.stringify(caught)).not.toContain(ACCESS_TOKEN);
  });

  it('busca una proyección segura filtrada por user_id', async () => {
    const { repository, from, select, eq, maybeSingle } = setupReadRepository({
      store_id: '987654',
      scope: 'write_products',
    });

    await expect(repository.findSummaryByUserId(USER_ID)).resolves.toEqual({
      storeId: '987654',
      scope: 'write_products',
    });
    expect(from).toHaveBeenCalledWith('tiendanube_connections');
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('store_id,scope');
    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('devuelve null cuando el usuario no tiene conexión', async () => {
    const { repository } = setupReadRepository(null);

    await expect(repository.findSummaryByUserId(USER_ID)).resolves.toBeNull();
  });

  it('oculta detalles sensibles cuando falla la lectura', async () => {
    const { repository } = setupReadRepository(null, {
      message: `database error containing ${ACCESS_TOKEN}`,
    });

    let caught: unknown;
    try {
      await repository.findSummaryByUserId(USER_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      status: 503,
      message: 'No se pudo leer la conexión de Tiendanube',
    });
    expect(JSON.stringify(caught)).not.toContain(ACCESS_TOKEN);
  });

  it('elimina conexiones con un filtro exacto por store_id', async () => {
    const { repository, from, remove, eq } = setupDeleteRepository();

    await expect(repository.deleteByStoreId('987654')).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('tiendanube_connections');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('store_id', '987654');
  });

  it('elimina todas las filas de la tienda indicada sin afectar otras tiendas', async () => {
    const rows = [
      { userId: 'user-a', storeId: '111111' },
      { userId: 'user-b', storeId: '222222' },
      { userId: 'user-c', storeId: '111111' },
    ];
    const eq = jest.fn((column: string, value: string) => {
      if (column === 'store_id') {
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (rows[index].storeId === value) rows.splice(index, 1);
        }
      }
      return Promise.resolve({ data: null, error: null });
    });
    const remove = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ delete: remove });
    const client = { from } as unknown as SupabaseClient<Database>;
    const supabase = {
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as SupabaseService;
    const repository = new SupabaseTiendanubeConnectionRepository(supabase);

    await repository.deleteByStoreId('111111');

    expect(rows).toEqual([{ userId: 'user-b', storeId: '222222' }]);
    expect(eq).toHaveBeenCalledWith('store_id', '111111');
  });

  it('es idempotente cuando la tienda no tiene conexiones', async () => {
    const { repository, eq } = setupDeleteRepository();

    await expect(repository.deleteByStoreId('987654')).resolves.toBeUndefined();
    await expect(repository.deleteByStoreId('987654')).resolves.toBeUndefined();

    expect(eq).toHaveBeenCalledTimes(2);
    expect(eq).toHaveBeenNthCalledWith(1, 'store_id', '987654');
    expect(eq).toHaveBeenNthCalledWith(2, 'store_id', '987654');
  });

  it('oculta el token y los detalles cuando falla la eliminación', async () => {
    const { repository } = setupDeleteRepository({
      message: `database error containing ${ACCESS_TOKEN}`,
    });

    let caught: unknown;
    try {
      await repository.deleteByStoreId('987654');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      status: 503,
      message: 'No se pudo eliminar la conexión de Tiendanube',
    });
    expect(JSON.stringify(caught)).not.toContain(ACCESS_TOKEN);
  });
});
