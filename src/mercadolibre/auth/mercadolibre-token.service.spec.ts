import { ConfigService } from '@nestjs/config';
import {
  MercadoLibreConnection,
  SupabaseService,
} from '../../database/supabase.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { MercadolibreAuthService } from './mercadolibre-auth.service';
import { MercadolibreTokenService } from './mercadolibre-token.service';

const connection: MercadoLibreConnection = {
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
  let authService: jest.Mocked<Pick<MercadolibreAuthService, 'saveTokens'>>;

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
    authService = { saveTokens: jest.fn() };
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

    await expect(service.getStoredConnection()).resolves.toEqual(connection);
    await expect(service.getStoredConnection()).rejects.toMatchObject({
      status: 401,
    });
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

    await expect(service.getValidAccessToken()).resolves.toBe(
      connection.access_token,
    );
    expect(refresh).not.toHaveBeenCalled();
    await expect(service.getValidAccessToken()).resolves.toBe(
      'renewed-access-token',
    );
    expect(refresh).toHaveBeenCalledWith(expiringConnection);
  });

  it('renueva el token con form data y guarda el reemplazo', async () => {
    const tokens = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 21_600,
      user_id: connection.seller_id,
    };
    apiService.postForm.mockResolvedValueOnce(tokens);

    await expect(service.refreshAccessToken(connection)).resolves.toBe(
      tokens.access_token,
    );
    expect(authService.saveTokens).toHaveBeenCalledWith(
      { id: connection.seller_id, nickname: connection.nickname },
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
});
