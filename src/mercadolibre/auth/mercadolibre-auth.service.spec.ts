import { ConfigService } from '@nestjs/config';
import {
  type MercadoLibreConnection,
  SupabaseService,
} from '../../database/supabase.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { MercadolibreAuthService } from './mercadolibre-auth.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const REFRESH_SESSION_ID = '33333333-3333-4333-8333-333333333333';

const configValues: Record<string, string> = {
  ML_CLIENT_ID: 'test-client-id',
  ML_CLIENT_SECRET: 'test-client-secret',
  ML_REDIRECT_URI: 'https://panel-ml.vercel.app/mercadolibre/callback',
  ML_STATE_SECRET: 'test-state-secret-with-at-least-32-bytes',
};

describe('MercadolibreAuthService', () => {
  let service: MercadolibreAuthService;
  let apiService: jest.Mocked<Pick<MercadolibreApiService, 'get' | 'postForm'>>;
  let supabaseService: jest.Mocked<
    Pick<
      SupabaseService,
      | 'saveConnection'
      | 'saveRefreshedConnection'
      | 'createMercadoLibreOAuthTransaction'
      | 'consumeMercadoLibreOAuthTransaction'
    >
  >;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    apiService = { get: jest.fn(), postForm: jest.fn() };
    supabaseService = {
      saveConnection: jest.fn(),
      saveRefreshedConnection: jest.fn(),
      createMercadoLibreOAuthTransaction: jest.fn().mockResolvedValue(true),
      consumeMercadoLibreOAuthTransaction: jest.fn().mockResolvedValue(true),
    };
    service = new MercadolibreAuthService(
      configService,
      apiService as unknown as MercadolibreApiService,
      supabaseService as unknown as SupabaseService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('crea una URL con un state único ligado al usuario y su sesión', async () => {
    const firstRequest = await service.createAuthorizationRequest(
      USER_ID,
      REFRESH_SESSION_ID,
    );
    const secondRequest = await service.createAuthorizationRequest(
      USER_ID,
      REFRESH_SESSION_ID,
    );
    const first = new URL(firstRequest.url);
    const second = new URL(secondRequest.url);
    const firstState = first.searchParams.get('state');
    const secondState = second.searchParams.get('state');

    expect(`${first.origin}${first.pathname}`).toBe(
      'https://auth.mercadolibre.com.ar/authorization',
    );
    expect(Object.fromEntries(first.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'test-client-id',
      redirect_uri: configValues.ML_REDIRECT_URI,
    });
    expect(first.searchParams.has('code_challenge')).toBe(false);
    expect(first.searchParams.has('code_challenge_method')).toBe(false);
    expect(firstState).not.toBe(secondState);
    expect(firstRequest.browserBinding).not.toBe(secondRequest.browserBinding);
    expect(firstRequest.cookieName).not.toBe(secondRequest.cookieName);
    expect(firstRequest.cookiePath).toBe('/mercadolibre/callback');
    expect(service.getCallbackCookiePath()).toBe('/mercadolibre/callback');
    expect(service.getAuthorizationCookieName(firstState!)).toBe(
      firstRequest.cookieName,
    );
    expect(firstRequest.secureCookie).toBe(true);
    await expect(
      service.verifyState(firstState!, firstRequest.browserBinding),
    ).resolves.toBe(USER_ID);
    await expect(
      service.verifyState(firstState!, secondRequest.browserBinding),
    ).resolves.toBeNull();
    expect(
      supabaseService.createMercadoLibreOAuthTransaction,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: USER_ID,
        refreshSessionId: REFRESH_SESSION_ID,
      }),
    );
  });

  it('rechaza states con usuario o nonce alterados y states vencidos', async () => {
    const now = 1_800_000_000_000;
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
    const request = await service.createAuthorizationRequest(
      USER_ID,
      REFRESH_SESSION_ID,
    );
    const state = new URL(request.url).searchParams.get('state')!;
    const [userId, nonce, timestamp, bindingHash, signature] = state.split('.');
    const tamperedNonce = `${nonce.startsWith('A') ? 'B' : 'A'}${nonce.slice(1)}`;

    await expect(
      service.verifyState('invalid', request.browserBinding),
    ).resolves.toBeNull();
    await expect(service.verifyState(state)).resolves.toBeNull();
    await expect(
      service.verifyState(
        `${OTHER_USER_ID}.${nonce}.${timestamp}.${bindingHash}.${signature}`,
        request.browserBinding,
      ),
    ).resolves.toBeNull();
    await expect(
      service.verifyState(
        `${userId}.${tamperedNonce}.${timestamp}.${bindingHash}.${signature}`,
        request.browserBinding,
      ),
    ).resolves.toBeNull();
    dateNow.mockReturnValue(now + 10 * 60 * 1000 + 1);
    await expect(
      service.verifyState(state, request.browserBinding),
    ).resolves.toBeNull();
    expect(
      supabaseService.consumeMercadoLibreOAuthTransaction,
    ).not.toHaveBeenCalled();
  });

  it('rechaza identificadores inválidos al iniciar OAuth', async () => {
    await expect(
      service.createAuthorizationRequest('not-a-user-id', REFRESH_SESSION_ID),
    ).rejects.toThrow('Usuario de la aplicación inválido');
    await expect(
      service.createAuthorizationRequest(USER_ID, 'not-a-session-id'),
    ).rejects.toThrow('Usuario de la aplicación inválido');
  });

  it('consume el state una sola vez', async () => {
    const request = await service.createAuthorizationRequest(
      USER_ID,
      REFRESH_SESSION_ID,
    );
    const state = new URL(request.url).searchParams.get('state')!;
    supabaseService.consumeMercadoLibreOAuthTransaction
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      service.verifyState(state, request.browserBinding),
    ).resolves.toBe(USER_ID);
    await expect(
      service.verifyState(state, request.browserBinding),
    ).resolves.toBeNull();
  });

  it('no inicia OAuth si la sesion autenticada ya no esta vigente', async () => {
    supabaseService.createMercadoLibreOAuthTransaction.mockResolvedValueOnce(
      false,
    );

    await expect(
      service.createAuthorizationRequest(USER_ID, REFRESH_SESSION_ID),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('intercambia el código con Authorization Code normal', async () => {
    const tokens = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 21_600,
      user_id: 123,
    };
    apiService.postForm.mockResolvedValueOnce(tokens);

    await expect(service.exchangeCode('authorization-code')).resolves.toEqual(
      tokens,
    );

    const [path, form, kind] = apiService.postForm.mock.calls[0];
    expect(path).toBe('/oauth/token');
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      code: 'authorization-code',
      redirect_uri: configValues.ML_REDIRECT_URI,
    });
    expect(kind).toBe('tokenExchange');
  });

  it('obtiene solamente id y nickname del vendedor', async () => {
    apiService.get.mockResolvedValueOnce({
      id: 123,
      nickname: 'SELLER',
      email: 'private@example.com',
      access_token: 'must-not-leak',
    });

    await expect(service.getCurrentUser('private-token')).resolves.toEqual({
      id: 123,
      nickname: 'SELLER',
    });
    expect(apiService.get).toHaveBeenCalledWith('/users/me', 'private-token');
  });

  it('guarda los tokens con expires_at sin devolverlos', async () => {
    const tokens = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      user_id: 123,
    };
    const before = Date.now();

    await expect(
      service.saveTokens(USER_ID, { id: 123, nickname: 'SELLER' }, tokens),
    ).resolves.toBeUndefined();

    const saved = supabaseService.saveConnection.mock.calls[0][0];
    expect(saved).toMatchObject({
      user_id: USER_ID,
      seller_id: 123,
      nickname: 'SELLER',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
    expect(Date.parse(saved.expires_at)).toBeGreaterThanOrEqual(
      before + 3600 * 1000,
    );
  });

  it('no guarda tokens si Mercado Libre devuelve otro seller', async () => {
    await expect(
      service.saveTokens(
        USER_ID,
        { id: 123, nickname: 'SELLER' },
        {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          user_id: 456,
        },
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(supabaseService.saveConnection).not.toHaveBeenCalled();
  });

  it('no permite que un refresh viejo sobrescriba una reconexion', async () => {
    const connection: MercadoLibreConnection = {
      user_id: USER_ID,
      seller_id: 123,
      nickname: 'SELLER',
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      expires_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const tokens = {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      user_id: 123,
    };
    supabaseService.saveRefreshedConnection.mockResolvedValueOnce(false);

    await expect(
      service.saveRefreshedTokens(USER_ID, connection, tokens),
    ).rejects.toMatchObject({ status: 409 });

    expect(supabaseService.saveRefreshedConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        seller_id: 123,
        access_token: 'new-access',
        refresh_token: 'new-refresh',
      }),
      connection.updated_at,
    );
  });
});
