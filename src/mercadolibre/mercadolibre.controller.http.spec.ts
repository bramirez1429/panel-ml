import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthService } from '../auth/application/auth.service';
import { AccessTokenProvider } from '../auth/application/ports/access-token-provider.port';
import { AuthConfiguration } from '../auth/application/ports/auth-configuration.port';
import { PasswordHasher } from '../auth/application/ports/password-hasher.port';
import { RefreshSessionRepository } from '../auth/application/ports/refresh-session-repository.port';
import { UserRepository } from '../auth/application/ports/user-repository.port';
import type { User } from '../auth/domain/auth.models';
import { JoseAccessTokenProvider } from '../auth/infrastructure/jose-access-token.provider';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreController } from './mercadolibre.controller';

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  passwordHash: '$argon2id$never-exposed',
  name: 'Test User',
  isActive: true,
  createdAt: new Date('2030-01-01T00:00:00.000Z'),
  updatedAt: new Date('2030-01-02T00:00:00.000Z'),
};
const REFRESH_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const COOKIE_NAME = `mercadolibre_oauth_binding_${'a'.repeat(43)}`;
const BROWSER_BINDING = 'b'.repeat(43);
const AUTHORIZATION_URL =
  'https://auth.mercadolibre.com.ar/authorization?state=signed-state';

type MockedPort<T> = jest.Mocked<Pick<T, keyof T>>;
type MercadoLibreAuthMock = jest.Mocked<
  Pick<
    MercadolibreAuthService,
    | 'createAuthorizationRequest'
    | 'getAuthorizationCookieName'
    | 'getCallbackCookiePath'
    | 'verifyState'
    | 'exchangeCode'
    | 'getCurrentUser'
    | 'saveTokens'
  >
>;

describe('MercadolibreController HTTP', () => {
  let app: INestApplication<App>;
  let accessTokens: AccessTokenProvider;
  let mlAuth: MercadoLibreAuthMock;

  beforeAll(async () => {
    const users: MockedPort<UserRepository> = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn().mockResolvedValue(USER),
    };
    const refreshSessions: MockedPort<RefreshSessionRepository> = {
      create: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
    };
    const passwordHasher: MockedPort<PasswordHasher> = {
      hash: jest.fn(),
      verify: jest.fn(),
    };
    mlAuth = {
      createAuthorizationRequest: jest.fn(),
      getAuthorizationCookieName: jest.fn(),
      getCallbackCookiePath: jest.fn(),
      verifyState: jest.fn(),
      exchangeCode: jest.fn(),
      getCurrentUser: jest.fn(),
      saveTokens: jest.fn(),
    };

    const moduleFixture = await Test.createTestingModule({
      controllers: [MercadolibreController],
      providers: [
        AuthService,
        AccessTokenGuard,
        { provide: UserRepository, useValue: users },
        { provide: RefreshSessionRepository, useValue: refreshSessions },
        { provide: PasswordHasher, useValue: passwordHasher },
        {
          provide: AuthConfiguration,
          useValue: {
            jwtAccessSecret: 'http-test-secret-with-at-least-32-bytes',
            jwtIssuer: 'panel-ml-api-test',
            jwtAudience: 'panel-ml-test',
            accessTokenTtlSeconds: 900,
            refreshSessionTtlMs: 86_400_000,
          },
        },
        { provide: AccessTokenProvider, useClass: JoseAccessTokenProvider },
        { provide: MercadolibreAuthService, useValue: mlAuth },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    accessTokens = moduleFixture.get(AccessTokenProvider);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mlAuth.createAuthorizationRequest.mockResolvedValue({
      url: AUTHORIZATION_URL,
      cookieName: COOKIE_NAME,
      cookiePath: '/mercadolibre/callback',
      browserBinding: BROWSER_BINDING,
      secureCookie: true,
    });
    mlAuth.getAuthorizationCookieName.mockReturnValue(COOKIE_NAME);
    mlAuth.getCallbackCookiePath.mockReturnValue('/mercadolibre/callback');
    mlAuth.verifyState.mockResolvedValue(USER.id);
    mlAuth.exchangeCode.mockResolvedValue({
      access_token: 'private-access-token',
      refresh_token: 'private-refresh-token',
      expires_in: 21_600,
      user_id: 123,
    });
    mlAuth.getCurrentUser.mockResolvedValue({ id: 123, nickname: 'SELLER' });
    mlAuth.saveTokens.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('exige Bearer en connect y emite la cookie HttpOnly con un JWT real', async () => {
    await request(app.getHttpServer()).get('/mercadolibre/connect').expect(401);

    const issuedAt = new Date();
    const accessToken = await accessTokens.issue({
      userId: USER.id,
      refreshSessionId: REFRESH_SESSION_ID,
      issuedAt,
      maximumExpiresAt: new Date(issuedAt.getTime() + 86_400_000),
    });
    const response = await request(app.getHttpServer())
      .get('/mercadolibre/connect')
      .set('Authorization', `Bearer ${accessToken.token}`)
      .expect(200)
      .expect({ url: AUTHORIZATION_URL });

    expect(response.headers['set-cookie']?.[0]).toContain(
      `${COOKIE_NAME}=${BROWSER_BINDING}`,
    );
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie']?.[0]).toContain(
      'Path=/mercadolibre/callback',
    );
    expect(mlAuth.createAuthorizationRequest).toHaveBeenCalledWith(
      USER.id,
      REFRESH_SESSION_ID,
    );
  });

  it('acepta el callback publico, consume cookie y nunca devuelve tokens', async () => {
    const response = await request(app.getHttpServer())
      .get('/mercadolibre/callback')
      .set('Cookie', `${COOKIE_NAME}=${BROWSER_BINDING}`)
      .query({ code: 'authorization-code', state: 'signed-state' })
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller: { id: 123, nickname: 'SELLER' },
    });
    expect(JSON.stringify(response.body)).not.toContain('private-access-token');
    expect(JSON.stringify(response.body)).not.toContain(
      'private-refresh-token',
    );
    expect(response.headers['set-cookie']?.[0]).toContain(`${COOKIE_NAME}=`);
    expect(response.headers['set-cookie']?.[0]).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
  });

  it('no borra una transaccion valida ante un callback invalido', async () => {
    mlAuth.verifyState.mockResolvedValueOnce(null);

    const response = await request(app.getHttpServer())
      .get('/mercadolibre/callback')
      .set('Cookie', `${COOKIE_NAME}=${BROWSER_BINDING}`)
      .query({ code: 'authorization-code', state: 'invalid-state' })
      .expect(401);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(mlAuth.exchangeCode).not.toHaveBeenCalled();
  });

  it('rechaza parametros OAuth duplicados antes de consumir el state', async () => {
    const response = await request(app.getHttpServer())
      .get('/mercadolibre/callback')
      .set('Cookie', `${COOKIE_NAME}=${BROWSER_BINDING}`)
      .query({ code: 'authorization-code', state: ['first', 'second'] })
      .expect(400);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(mlAuth.verifyState).not.toHaveBeenCalled();
    expect(mlAuth.exchangeCode).not.toHaveBeenCalled();
  });
});
