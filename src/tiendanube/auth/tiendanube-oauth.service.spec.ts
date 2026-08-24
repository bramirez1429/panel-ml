import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import {
  TIENDANUBE_OAUTH_STATE_TTL_MS,
  type TiendanubeEnvironment,
} from '../shared/tiendanube.config';
import { TiendanubeOAuthService } from './tiendanube-oauth.service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CONFIG: TiendanubeEnvironment = {
  TIENDANUBE_CLIENT_ID: '123',
  TIENDANUBE_CLIENT_SECRET: 'private-client-secret',
  TIENDANUBE_REDIRECT_URI: 'https://panel-ml.vercel.app/tiendanube/callback',
  TIENDANUBE_USER_AGENT: 'Panel ML (contact@example.com)',
};

type ApiMock = jest.Mocked<Pick<TiendanubeApiService, 'postOAuthToken'>>;
type ConnectionRepositoryMock = jest.Mocked<
  Pick<
    TiendanubeConnectionRepository,
    'saveConnection' | 'findSummaryByUserId' | 'deleteByStoreId'
  >
>;

describe('TiendanubeOAuthService', () => {
  let service: TiendanubeOAuthService;
  let apiService: ApiMock;
  let connectionRepository: ConnectionRepositoryMock;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: keyof TiendanubeEnvironment) => CONFIG[key]),
    } as unknown as ConfigService<TiendanubeEnvironment>;
    apiService = {
      postOAuthToken: jest.fn(),
    };
    connectionRepository = {
      saveConnection: jest.fn(),
      findSummaryByUserId: jest.fn(),
      deleteByStoreId: jest.fn(),
    };
    service = new TiendanubeOAuthService(
      configService,
      apiService as unknown as TiendanubeApiService,
      connectionRepository,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('genera la URL correcta con states únicos asociados a cada usuario', () => {
    const first = service.createAuthorizationRequest(USER_A);
    const second = service.createAuthorizationRequest(USER_B);
    const firstUrl = new URL(first.url);
    const secondUrl = new URL(second.url);
    const firstState = firstUrl.searchParams.get('state');
    const secondState = secondUrl.searchParams.get('state');

    expect(`${firstUrl.origin}${firstUrl.pathname}`).toBe(
      'https://www.tiendanube.com/apps/123/authorize',
    );
    expect([...firstUrl.searchParams.keys()]).toEqual(['state']);
    expect(firstState).toBeTruthy();
    expect(secondState).toBeTruthy();
    expect(firstState).not.toBe(secondState);
    expect(first.cookiePath).toBe('/tiendanube/callback');
    expect(first.secureCookie).toBe(true);
    expect(first.url).not.toContain(CONFIG.TIENDANUBE_CLIENT_SECRET);

    if (!firstState || !secondState) {
      throw new Error('Los states OAuth deberían existir');
    }

    expect(service.verifyState(firstState, first.browserBinding)).toBe(USER_A);
    expect(service.verifyState(secondState, second.browserBinding)).toBe(
      USER_B,
    );
    expect(service.verifyState(firstState, second.browserBinding)).toBeNull();
    expect(
      service.verifyState(
        firstState.replace(USER_A, USER_B),
        first.browserBinding,
      ),
    ).toBeNull();
    expect(service.getAuthorizationCookieName(firstState)).toBe(
      first.cookieName,
    );
  });

  it('rechaza un state alterado o vencido', () => {
    const now = Date.parse('2030-01-01T00:00:00.000Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const authorization = service.createAuthorizationRequest(USER_A);
    const state = new URL(authorization.url).searchParams.get('state');

    if (!state) throw new Error('Falta state OAuth');
    const lastCharacter = state.at(-1);
    const tamperedState = `${state.slice(0, -1)}${lastCharacter === 'a' ? 'b' : 'a'}`;

    expect(
      service.verifyState(tamperedState, authorization.browserBinding),
    ).toBeNull();

    clock.mockReturnValue(now + TIENDANUBE_OAUTH_STATE_TTL_MS + 1);
    expect(service.verifyState(state, authorization.browserBinding)).toBeNull();
  });

  it('intercambia el code, persiste la conexión y retorna sólo datos seguros', async () => {
    apiService.postOAuthToken.mockResolvedValue({
      access_token: 'private-access-token',
      token_type: 'bearer',
      scope: 'read_products',
      user_id: 987654,
    });

    const result = await service.completeAuthorization(
      USER_A,
      ' authorization-code ',
    );

    expect(apiService.postOAuthToken).toHaveBeenCalledWith({
      client_id: CONFIG.TIENDANUBE_CLIENT_ID,
      client_secret: CONFIG.TIENDANUBE_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: 'authorization-code',
    });
    expect(connectionRepository.saveConnection).toHaveBeenCalledWith({
      userId: USER_A,
      storeId: '987654',
      accessToken: 'private-access-token',
      tokenType: 'bearer',
      scope: 'read_products',
    });
    expect(result).toEqual({
      storeId: '987654',
      scope: 'read_products',
    });
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain('private-access-token');
    expect(serializedResult).not.toContain(CONFIG.TIENDANUBE_CLIENT_SECRET);
  });

  it('no guarda una conexión cuando Tiendanube rechaza el intercambio', async () => {
    apiService.postOAuthToken.mockRejectedValue(
      new Error('OAuth exchange rejected'),
    );

    await expect(
      service.completeAuthorization(USER_A, 'authorization-code'),
    ).rejects.toThrow('OAuth exchange rejected');
    expect(connectionRepository.saveConnection).not.toHaveBeenCalled();
  });

  it('no devuelve éxito cuando falla la persistencia', async () => {
    apiService.postOAuthToken.mockResolvedValue({
      access_token: 'private-access-token',
      token_type: 'bearer',
      scope: 'read_products',
      user_id: 987654,
    });
    connectionRepository.saveConnection.mockRejectedValue(
      new ServiceUnavailableException(
        'No se pudo guardar la conexión de Tiendanube',
      ),
    );

    await expect(
      service.completeAuthorization(USER_A, 'authorization-code'),
    ).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo guardar la conexión de Tiendanube',
    });
    expect(connectionRepository.saveConnection).toHaveBeenCalledTimes(1);
  });
});
