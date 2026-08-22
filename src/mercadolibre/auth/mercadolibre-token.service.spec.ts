import { ConfigService } from '@nestjs/config';
import {
  MercadoLibreConnection,
  SupabaseService,
} from '../../database/supabase.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { MercadolibreAuthService } from './mercadolibre-auth.service';
import { MercadolibreTokenService } from './mercadolibre-token.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';

const connection: MercadoLibreConnection = {
  user_id: USER_ID,
  seller_id: 123,
  nickname: 'SELLER',
  access_token: 'stored-access-token',
  refresh_token: 'stored-refresh-token',
  expires_at: '2030-01-01T00:00:00.000Z',
  updated_at: '2029-12-31T00:00:00.000Z',
};

describe('MercadolibreTokenService', () => {
  let service: MercadolibreTokenService;
  let apiService: jest.Mocked<Pick<MercadolibreApiService, 'postForm'>>;
  let supabaseService: jest.Mocked<Pick<SupabaseService, 'getConnection'>>;
  let authService: jest.Mocked<
    Pick<MercadolibreAuthService, 'saveRefreshedTokens'>
  >;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          ML_CLIENT_ID: 'test-client-id',
          ML_CLIENT_SECRET: 'test-client-secret',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    apiService = { postForm: jest.fn() };
    supabaseService = { getConnection: jest.fn() };
    authService = { saveRefreshedTokens: jest.fn() };
    service = new MercadolibreTokenService(
      configService,
      apiService as unknown as MercadolibreApiService,
      supabaseService as unknown as SupabaseService,
      authService as unknown as MercadolibreAuthService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lee la conexión o informa que primero hay que conectar la cuenta', async () => {
    supabaseService.getConnection
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(null);

    await expect(service.getStoredConnection(USER_ID)).resolves.toEqual(
      connection,
    );
    await expect(service.getStoredConnection(USER_ID)).rejects.toMatchObject({
      status: 401,
    });
    expect(supabaseService.getConnection).toHaveBeenNthCalledWith(1, USER_ID);
    expect(supabaseService.getConnection).toHaveBeenNthCalledWith(2, USER_ID);
  });

  it('reutiliza un token vigente y renueva uno próximo a vencer', async () => {
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const validConnection = {
      ...connection,
      expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
    };
    const expiringConnection = {
      ...connection,
      expires_at: new Date(now + 5 * 60 * 1000).toISOString(),
    };
    supabaseService.getConnection
      .mockResolvedValueOnce(validConnection)
      .mockResolvedValueOnce(expiringConnection);
    const refresh = jest
      .spyOn(service, 'refreshAccessToken')
      .mockResolvedValue('renewed-access-token');

    await expect(service.getValidAccessToken(USER_ID)).resolves.toBe(
      connection.access_token,
    );
    expect(refresh).not.toHaveBeenCalled();
    await expect(service.getValidAccessToken(USER_ID)).resolves.toBe(
      'renewed-access-token',
    );
    expect(refresh).toHaveBeenCalledWith(USER_ID, expiringConnection);
  });

  it('rechaza una conexión perteneciente a otro usuario antes de usarla o renovarla', async () => {
    const foreignConnection = { ...connection, user_id: OTHER_USER_ID };

    await expect(
      service.getValidAccessToken(USER_ID, foreignConnection),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.refreshAccessToken(USER_ID, foreignConnection),
    ).rejects.toMatchObject({ status: 401 });
    expect(apiService.postForm).not.toHaveBeenCalled();
    expect(authService.saveRefreshedTokens).not.toHaveBeenCalled();
  });

  it('renueva el token con form data y guarda el reemplazo', async () => {
    const tokens = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 21_600,
      user_id: connection.seller_id,
    };
    apiService.postForm.mockResolvedValueOnce(tokens);

    await expect(service.refreshAccessToken(USER_ID, connection)).resolves.toBe(
      tokens.access_token,
    );
    expect(authService.saveRefreshedTokens).toHaveBeenCalledWith(
      USER_ID,
      connection,
      tokens,
    );
    const [path, form, kind] = apiService.postForm.mock.calls[0];
    expect(path).toBe('/oauth/token');
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      refresh_token: connection.refresh_token,
    });
    expect(kind).toBe('tokenExchange');
  });

  it('comparte el mismo refresh entre requests concurrentes', async () => {
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const expiringConnection = {
      ...connection,
      expires_at: new Date(now).toISOString(),
    };
    apiService.postForm.mockResolvedValue({
      access_token: 'shared-access-token',
      refresh_token: 'shared-refresh-token',
      expires_in: 21_600,
      user_id: connection.seller_id,
    });

    await expect(
      Promise.all([
        service.getValidAccessToken(USER_ID, expiringConnection),
        service.getValidAccessToken(USER_ID, expiringConnection),
      ]),
    ).resolves.toEqual(['shared-access-token', 'shared-access-token']);

    expect(apiService.postForm).toHaveBeenCalledTimes(1);
    expect(authService.saveRefreshedTokens).toHaveBeenCalledTimes(1);
  });

  it('usa el token que otro worker guardo si pierde la carrera de refresh', async () => {
    const currentConnection = {
      ...connection,
      access_token: 'winner-access-token',
      refresh_token: 'winner-refresh-token',
      expires_at: new Date(Date.now() + 21_600_000).toISOString(),
      updated_at: new Date(Date.now() + 1000).toISOString(),
    };
    apiService.postForm.mockResolvedValueOnce({
      access_token: 'loser-access-token',
      refresh_token: 'loser-refresh-token',
      expires_in: 21_600,
      user_id: connection.seller_id,
    });
    authService.saveRefreshedTokens.mockRejectedValueOnce(
      new Error('CAS conflict'),
    );
    supabaseService.getConnection.mockResolvedValueOnce(currentConnection);

    await expect(service.refreshAccessToken(USER_ID, connection)).resolves.toBe(
      'winner-access-token',
    );
  });

  it('no recupera el token de una reconexion a otro seller', async () => {
    apiService.postForm.mockRejectedValueOnce(new Error('invalid_grant'));
    supabaseService.getConnection.mockResolvedValueOnce({
      ...connection,
      seller_id: 999,
      access_token: 'other-seller-access-token',
      refresh_token: 'other-seller-refresh-token',
      expires_at: new Date(Date.now() + 21_600_000).toISOString(),
      updated_at: new Date(Date.now() + 1000).toISOString(),
    });

    await expect(
      service.refreshAccessToken(USER_ID, connection),
    ).rejects.toThrow('invalid_grant');
  });

  it('espera brevemente el commit de otro worker tras invalid_grant', async () => {
    const winner = {
      ...connection,
      access_token: 'eventual-winner-access',
      refresh_token: 'eventual-winner-refresh',
      expires_at: new Date(Date.now() + 21_600_000).toISOString(),
      updated_at: new Date(Date.now() + 1000).toISOString(),
    };
    apiService.postForm.mockRejectedValueOnce(new Error('invalid_grant'));
    supabaseService.getConnection
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(winner);

    await expect(service.refreshAccessToken(USER_ID, connection)).resolves.toBe(
      'eventual-winner-access',
    );
    expect(supabaseService.getConnection).toHaveBeenCalledTimes(2);
  });

  it('limpia el single-flight fallido y permite reintentar', async () => {
    const expiringConnection = {
      ...connection,
      expires_at: new Date(Date.now()).toISOString(),
    };
    apiService.postForm
      .mockRejectedValueOnce(new Error('temporary refresh failure'))
      .mockResolvedValueOnce({
        access_token: 'retried-access-token',
        refresh_token: 'retried-refresh-token',
        expires_in: 21_600,
        user_id: connection.seller_id,
      });
    supabaseService.getConnection.mockResolvedValueOnce(expiringConnection);

    await expect(
      service.getValidAccessToken(USER_ID, expiringConnection),
    ).rejects.toThrow('temporary refresh failure');
    await expect(
      service.getValidAccessToken(USER_ID, expiringConnection),
    ).resolves.toBe('retried-access-token');
    expect(apiService.postForm).toHaveBeenCalledTimes(2);
  });

  it('mantiene separados los refresh concurrentes de usuarios distintos', async () => {
    const connectionA = {
      ...connection,
      expires_at: new Date(Date.now()).toISOString(),
    };
    const connectionB = {
      ...connection,
      user_id: OTHER_USER_ID,
      seller_id: 456,
      access_token: 'stored-access-b',
      refresh_token: 'stored-refresh-b',
      expires_at: new Date(Date.now()).toISOString(),
    };
    apiService.postForm.mockImplementation((_path, form) => {
      const isUserA = form.get('refresh_token') === connectionA.refresh_token;
      return Promise.resolve({
        access_token: isUserA ? 'access-a' : 'access-b',
        refresh_token: isUserA ? 'refresh-a' : 'refresh-b',
        expires_in: 21_600,
        user_id: isUserA ? connectionA.seller_id : connectionB.seller_id,
      });
    });

    await expect(
      Promise.all([
        service.getValidAccessToken(USER_ID, connectionA),
        service.getValidAccessToken(OTHER_USER_ID, connectionB),
      ]),
    ).resolves.toEqual(['access-a', 'access-b']);
    expect(authService.saveRefreshedTokens).toHaveBeenCalledWith(
      USER_ID,
      connectionA,
      expect.objectContaining({ access_token: 'access-a' }),
    );
    expect(authService.saveRefreshedTokens).toHaveBeenCalledWith(
      OTHER_USER_ID,
      connectionB,
      expect.objectContaining({ access_token: 'access-b' }),
    );
  });
});
