import { ConfigService } from '@nestjs/config';
import { MercadoLibreConnection, SupabaseService } from './supabase.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION: MercadoLibreConnection = {
  user_id: USER_ID,
  seller_id: 123,
  nickname: 'SELLER',
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_at: '2030-01-01T00:00:00.000Z',
  updated_at: '2029-12-31T00:00:00.000Z',
};

describe('SupabaseService Mercado Libre connections', () => {
  let service: SupabaseService;

  beforeEach(() => {
    service = new SupabaseService({
      get: jest.fn(),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hace upsert por user_id y conserva el dueño en la fila', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ upsert });
    jest
      .spyOn(service, 'getClient')
      .mockReturnValue({ from } as unknown as ReturnType<
        SupabaseService['getClient']
      >);

    await expect(service.saveConnection(CONNECTION)).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledWith('mercadolibre_tokens');
    expect(upsert).toHaveBeenCalledWith(CONNECTION, {
      onConflict: 'user_id',
    });
  });

  it('filtra la lectura exclusivamente por user_id', async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: CONNECTION, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    jest
      .spyOn(service, 'getClient')
      .mockReturnValue({ from } as unknown as ReturnType<
        SupabaseService['getClient']
      >);

    await expect(service.getConnection(USER_ID)).resolves.toEqual(CONNECTION);

    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('crea y consume la transaccion OAuth mediante RPCs atomicas', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    jest
      .spyOn(service, 'getClient')
      .mockReturnValue({ rpc } as unknown as ReturnType<
        SupabaseService['getClient']
      >);
    const transaction = {
      stateHash: 'a'.repeat(64),
      userId: USER_ID,
      refreshSessionId: '33333333-3333-4333-8333-333333333333',
      browserBindingHash: 'b'.repeat(43),
      expiresAt: '2030-01-01T00:10:00.000Z',
    };

    await expect(
      service.createMercadoLibreOAuthTransaction(transaction),
    ).resolves.toBe(true);
    await expect(
      service.consumeMercadoLibreOAuthTransaction({
        stateHash: transaction.stateHash,
        userId: transaction.userId,
        browserBindingHash: transaction.browserBindingHash,
      }),
    ).resolves.toBe(false);

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'create_mercadolibre_oauth_transaction',
      {
        p_state_hash: transaction.stateHash,
        p_user_id: transaction.userId,
        p_refresh_session_id: transaction.refreshSessionId,
        p_browser_binding_hash: transaction.browserBindingHash,
        p_expires_at: transaction.expiresAt,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'consume_mercadolibre_oauth_transaction',
      {
        p_state_hash: transaction.stateHash,
        p_user_id: transaction.userId,
        p_browser_binding_hash: transaction.browserBindingHash,
      },
    );
  });

  it('convierte errores de los RPC OAuth en respuestas 503 seguras', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive database detail' },
    });
    jest
      .spyOn(service, 'getClient')
      .mockReturnValue({ rpc } as unknown as ReturnType<
        SupabaseService['getClient']
      >);
    const transaction = {
      stateHash: 'a'.repeat(64),
      userId: USER_ID,
      refreshSessionId: '33333333-3333-4333-8333-333333333333',
      browserBindingHash: 'b'.repeat(43),
      expiresAt: '2030-01-01T00:10:00.000Z',
    };

    await expect(
      service.createMercadoLibreOAuthTransaction(transaction),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      service.consumeMercadoLibreOAuthTransaction({
        stateHash: transaction.stateHash,
        userId: transaction.userId,
        browserBindingHash: transaction.browserBindingHash,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('actualiza un refresh solo si owner, seller y version anterior coinciden', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { user_id: USER_ID },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const eq = jest.fn();
    const filters = { eq, select };
    eq.mockReturnValue(filters);
    const update = jest.fn().mockReturnValue(filters);
    const from = jest.fn().mockReturnValue({ update });
    jest
      .spyOn(service, 'getClient')
      .mockReturnValue({ from } as unknown as ReturnType<
        SupabaseService['getClient']
      >);

    await expect(
      service.saveRefreshedConnection(CONNECTION, CONNECTION.updated_at),
    ).resolves.toBe(true);

    expect(eq.mock.calls).toEqual([
      ['user_id', USER_ID],
      ['seller_id', CONNECTION.seller_id],
      ['updated_at', CONNECTION.updated_at],
    ]);
    expect(select).toHaveBeenCalledWith('user_id');
  });

  it('informa un CAS perdido cuando ninguna fila coincide', async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const eq = jest.fn();
    const filters = { eq, select };
    eq.mockReturnValue(filters);
    const update = jest.fn().mockReturnValue(filters);
    jest.spyOn(service, 'getClient').mockReturnValue({
      from: jest.fn().mockReturnValue({ update }),
    } as unknown as ReturnType<SupabaseService['getClient']>);

    await expect(
      service.saveRefreshedConnection(CONNECTION, CONNECTION.updated_at),
    ).resolves.toBe(false);
  });

  it('convierte un error de Supabase durante CAS en 503', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive database detail' },
    });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const eq = jest.fn();
    const filters = { eq, select };
    eq.mockReturnValue(filters);
    const update = jest.fn().mockReturnValue(filters);
    jest.spyOn(service, 'getClient').mockReturnValue({
      from: jest.fn().mockReturnValue({ update }),
    } as unknown as ReturnType<SupabaseService['getClient']>);

    await expect(
      service.saveRefreshedConnection(CONNECTION, CONNECTION.updated_at),
    ).rejects.toMatchObject({ status: 503 });
    expect(maybeSingle).toHaveBeenCalledTimes(3);
  });

  it('reintenta la persistencia de tokens ante un error transitorio', async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'temporary' } })
      .mockResolvedValueOnce({ data: { user_id: USER_ID }, error: null });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const eq = jest.fn();
    const filters = { eq, select };
    eq.mockReturnValue(filters);
    const update = jest.fn().mockReturnValue(filters);
    jest.spyOn(service, 'getClient').mockReturnValue({
      from: jest.fn().mockReturnValue({ update }),
    } as unknown as ReturnType<SupabaseService['getClient']>);

    await expect(
      service.saveRefreshedConnection(CONNECTION, CONNECTION.updated_at),
    ).resolves.toBe(true);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('permite resolver por seller sólo para procesos externos identificados', async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: CONNECTION, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    jest
      .spyOn(service, 'getClient')
      .mockReturnValue({ from } as unknown as ReturnType<
        SupabaseService['getClient']
      >);

    await expect(service.getConnectionBySellerId(123)).resolves.toEqual(
      CONNECTION,
    );
    expect(eq).toHaveBeenCalledWith('seller_id', 123);
  });
});
