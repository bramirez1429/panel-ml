import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../database/supabase.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { MercadolibreAuthService } from './mercadolibre-auth.service';

const configValues: Record<string, string> = {
  ML_CLIENT_ID: 'test-client-id',
  ML_CLIENT_SECRET: 'test-client-secret',
  ML_REDIRECT_URI: 'https://panel-ml.vercel.app/mercadolibre/callback',
  ML_STATE_SECRET: 'test-state-secret-with-at-least-32-bytes',
};

describe('MercadolibreAuthService', () => {
  let service: MercadolibreAuthService;
  let apiService: jest.Mocked<Pick<MercadolibreApiService, 'get' | 'postForm'>>;
  let supabaseService: jest.Mocked<Pick<SupabaseService, 'saveConnection'>>;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    apiService = { get: jest.fn(), postForm: jest.fn() };
    supabaseService = { saveConnection: jest.fn() };
    service = new MercadolibreAuthService(
      configService,
      apiService as unknown as MercadolibreApiService,
      supabaseService as unknown as SupabaseService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('crea una URL sin PKCE y con un state único verificable', () => {
    const first = new URL(service.createAuthorizationUrl());
    const second = new URL(service.createAuthorizationUrl());
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
    expect(service.verifyState(firstState!)).toBe(true);
  });

  it('rechaza states alterados o vencidos', () => {
    const now = 1_800_000_000_000;
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
    const state = new URL(service.createAuthorizationUrl()).searchParams.get(
      'state',
    )!;
    const [nonce, timestamp, signature] = state.split('.');
    const tamperedNonce = `${nonce.startsWith('A') ? 'B' : 'A'}${nonce.slice(1)}`;

    expect(service.verifyState('invalid')).toBe(false);
    expect(
      service.verifyState(`${tamperedNonce}.${timestamp}.${signature}`),
    ).toBe(false);
    dateNow.mockReturnValue(now + 10 * 60 * 1000 + 1);
    expect(service.verifyState(state)).toBe(false);
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
      service.saveTokens({ id: 123, nickname: 'SELLER' }, tokens),
    ).resolves.toBeUndefined();

    const saved = supabaseService.saveConnection.mock.calls[0][0];
    expect(saved).toMatchObject({
      seller_id: 123,
      nickname: 'SELLER',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
    expect(Date.parse(saved.expires_at)).toBeGreaterThanOrEqual(
      before + 3600 * 1000,
    );
  });
});
