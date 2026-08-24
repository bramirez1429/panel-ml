import { BadRequestException, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AuthService } from '../auth/application/auth.service';
import { AuthConfiguration } from '../auth/application/ports/auth-configuration.port';
import type { SafeUser } from '../auth/domain/auth.models';
import {
  TiendanubeOAuthService,
  type TiendanubeOAuthResult,
} from './auth/tiendanube-oauth.service';
import {
  TiendanubeConnectionService,
  type TiendanubeConnectionStatus,
} from './connections/tiendanube-connection.service';
import { TiendanubeModule } from './tiendanube.module';

const USER: SafeUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: 'Test User',
  isActive: true,
  createdAt: new Date('2030-01-01T00:00:00.000Z'),
  updatedAt: new Date('2030-01-02T00:00:00.000Z'),
};
const USER_B: SafeUser = {
  ...USER,
  id: '33333333-3333-4333-8333-333333333333',
  email: 'user-b@example.com',
};
const REFRESH_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const COOKIE_NAME = `tiendanube_oauth_binding_${'c'.repeat(43)}`;
const BROWSER_BINDING = 'b'.repeat(43);
const AUTHORIZATION_URL =
  'https://www.tiendanube.com/apps/123/authorize?state=signed-state';

type AuthMock = jest.Mocked<Pick<AuthService, 'authenticateAccessToken'>>;
type OAuthMock = jest.Mocked<
  Pick<
    TiendanubeOAuthService,
    | 'createAuthorizationRequest'
    | 'getAuthorizationCookieName'
    | 'getCallbackCookiePath'
    | 'verifyState'
    | 'completeAuthorization'
  >
>;
type ConnectionServiceMock = jest.Mocked<
  Pick<TiendanubeConnectionService, 'getStatus'>
>;

describe('TiendanubeController HTTP', () => {
  let app: INestApplication<App>;
  let authService: AuthMock;
  let oauthService: OAuthMock;
  let connectionService: ConnectionServiceMock;

  beforeAll(async () => {
    authService = {
      authenticateAccessToken: jest.fn(),
    };
    oauthService = {
      createAuthorizationRequest: jest.fn(),
      getAuthorizationCookieName: jest.fn(),
      getCallbackCookiePath: jest.fn(),
      verifyState: jest.fn(),
      completeAuthorization: jest.fn(),
    };
    connectionService = {
      getStatus: jest.fn(),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TiendanubeModule,
      ],
    })
      .overrideProvider(AuthService)
      .useValue(authService)
      .overrideProvider(AuthConfiguration)
      .useValue({
        jwtAccessSecret: 'test-secret-with-at-least-32-bytes',
        jwtIssuer: 'panel-ml-api-test',
        jwtAudience: 'panel-ml-test',
        accessTokenTtlSeconds: 900,
        refreshSessionTtlMs: 86_400_000,
      })
      .overrideProvider(TiendanubeOAuthService)
      .useValue(oauthService)
      .overrideProvider(TiendanubeConnectionService)
      .useValue(connectionService)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authService.authenticateAccessToken.mockImplementation((accessToken) =>
      Promise.resolve({
        user: accessToken === 'app-token-b' ? USER_B : USER,
        refreshSessionId: REFRESH_SESSION_ID,
      }),
    );
    oauthService.createAuthorizationRequest.mockReturnValue({
      url: AUTHORIZATION_URL,
      cookieName: COOKIE_NAME,
      cookiePath: '/tiendanube/callback',
      browserBinding: BROWSER_BINDING,
      secureCookie: true,
    });
    oauthService.getAuthorizationCookieName.mockReturnValue(COOKIE_NAME);
    oauthService.getCallbackCookiePath.mockReturnValue('/tiendanube/callback');
    oauthService.verifyState.mockReturnValue(USER.id);
    oauthService.completeAuthorization.mockResolvedValue({
      storeId: '987654',
      scope: 'read_products',
    });
    connectionService.getStatus.mockImplementation((userId) =>
      Promise.resolve(
        userId === USER.id
          ? {
              connected: true,
              storeId: '987654',
              scope: 'write_products',
            }
          : { connected: false },
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('protege connect y genera la autorización para el usuario autenticado', async () => {
    await request(app.getHttpServer()).get('/tiendanube/connect').expect(401);

    const response = await request(app.getHttpServer())
      .get('/tiendanube/connect')
      .set('Authorization', 'Bearer application-access-token')
      .expect(200)
      .expect({ url: AUTHORIZATION_URL });

    expect(authService.authenticateAccessToken).toHaveBeenCalledWith(
      'application-access-token',
    );
    expect(oauthService.createAuthorizationRequest).toHaveBeenCalledWith(
      USER.id,
    );
    expect(response.headers['set-cookie']?.[0]).toContain(
      `${COOKIE_NAME}=${BROWSER_BINDING}`,
    );
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie']?.[0]).toContain(
      'Path=/tiendanube/callback',
    );
  });

  it('protege la consulta de conexión', async () => {
    await request(app.getHttpServer())
      .get('/tiendanube/connection')
      .expect(401);

    expect(connectionService.getStatus).not.toHaveBeenCalled();
  });

  it('devuelve la conexión del usuario autenticado sin exponer secretos', async () => {
    connectionService.getStatus.mockResolvedValue({
      connected: true,
      storeId: '987654',
      scope: 'write_products',
      access_token: 'private-access-token',
      tokenType: 'bearer',
      clientSecret: 'private-client-secret',
    } as unknown as TiendanubeConnectionStatus);

    const response = await request(app.getHttpServer())
      .get('/tiendanube/connection')
      .set('Authorization', 'Bearer app-token-a')
      .query({ userId: USER_B.id })
      .expect(200)
      .expect({
        connected: true,
        storeId: '987654',
        scope: 'write_products',
      });

    expect(connectionService.getStatus).toHaveBeenCalledTimes(1);
    expect(connectionService.getStatus).toHaveBeenCalledWith(USER.id);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(
      /access[_-]?token|tokenType|client[_-]?secret|private-access-token|private-client-secret/i,
    );
  });

  it('usuario B sin conexión no puede consultar la conexión de A', async () => {
    const response = await request(app.getHttpServer())
      .get('/tiendanube/connection')
      .set('Authorization', 'Bearer app-token-b')
      .query({ userId: USER.id })
      .expect(200)
      .expect({ connected: false });

    expect(response.body).toEqual({ connected: false });
    expect(connectionService.getStatus).toHaveBeenCalledTimes(1);
    expect(connectionService.getStatus).toHaveBeenCalledWith(USER_B.id);
  });

  it('rechaza callback sin code', async () => {
    const response = await request(app.getHttpServer())
      .get('/tiendanube/callback')
      .query({ state: 'signed-state' })
      .expect(400);

    expect(response.body).toMatchObject({
      message: 'Falta el código de autorización',
    });
    expect(oauthService.verifyState).not.toHaveBeenCalled();
    expect(oauthService.completeAuthorization).not.toHaveBeenCalled();
  });

  it('rechaza callback sin state', async () => {
    const response = await request(app.getHttpServer())
      .get('/tiendanube/callback')
      .query({ code: 'authorization-code' })
      .expect(400);

    expect(response.body).toMatchObject({ message: 'Falta el state OAuth' });
    expect(oauthService.verifyState).not.toHaveBeenCalled();
    expect(oauthService.completeAuthorization).not.toHaveBeenCalled();
  });

  it('rechaza un state inválido antes del intercambio', async () => {
    oauthService.verifyState.mockReturnValue(null);

    const response = await request(app.getHttpServer())
      .get('/tiendanube/callback')
      .set('Cookie', `${COOKIE_NAME}=${BROWSER_BINDING}`)
      .query({ code: 'authorization-code', state: 'invalid-state' })
      .expect(401);

    expect(response.body).toMatchObject({
      message: 'El state de Tiendanube es inválido o venció',
    });
    expect(oauthService.completeAuthorization).not.toHaveBeenCalled();
  });

  it('convierte user_id a storeId y nunca devuelve secretos', async () => {
    oauthService.completeAuthorization.mockResolvedValue({
      storeId: '987654',
      scope: 'read_products',
      access_token: 'private-access-token',
      client_secret: 'private-client-secret',
    } as unknown as TiendanubeOAuthResult);

    const response = await request(app.getHttpServer())
      .get('/tiendanube/callback')
      .set('Cookie', `${COOKIE_NAME}=${BROWSER_BINDING}`)
      .query({
        code: 'authorization-code',
        state: 'signed-state',
        userId: '22222222-2222-4222-8222-222222222222',
      })
      .expect(200)
      .expect({
        ok: true,
        storeId: '987654',
        scope: 'read_products',
      });

    const serializedBody = JSON.stringify(response.body);
    expect(serializedBody).not.toContain('private-access-token');
    expect(serializedBody).not.toContain('private-client-secret');
    expect(oauthService.verifyState).toHaveBeenCalledWith(
      'signed-state',
      BROWSER_BINDING,
    );
    expect(oauthService.completeAuthorization).toHaveBeenCalledWith(
      USER.id,
      'authorization-code',
    );
    expect(oauthService.completeAuthorization).toHaveBeenCalledTimes(1);
    expect(response.headers['set-cookie']?.[0]).toContain(`${COOKIE_NAME}=`);
    expect(response.headers['set-cookie']?.[0]).toContain(
      'Path=/tiendanube/callback',
    );
  });

  it('devuelve un error claro cuando Tiendanube rechaza OAuth', async () => {
    oauthService.completeAuthorization.mockRejectedValue(
      new BadRequestException('Tiendanube rechazó el intercambio OAuth'),
    );

    const response = await request(app.getHttpServer())
      .get('/tiendanube/callback')
      .set('Cookie', `${COOKIE_NAME}=${BROWSER_BINDING}`)
      .query({ code: 'rejected-code', state: 'signed-state' })
      .expect(400);

    expect(response.body).toMatchObject({
      message: 'Tiendanube rechazó el intercambio OAuth',
    });
    expect(JSON.stringify(response.body)).not.toContain('private');
  });
});
