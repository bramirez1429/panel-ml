import type { INestApplication } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthService } from '../application/auth.service';
import { AccessTokenProvider } from '../application/ports/access-token-provider.port';
import { AuthConfiguration } from '../application/ports/auth-configuration.port';
import { PasswordHasher } from '../application/ports/password-hasher.port';
import { RefreshSessionRepository } from '../application/ports/refresh-session-repository.port';
import { UserRepository } from '../application/ports/user-repository.port';
import type { User } from '../domain/auth.models';
import { JoseAccessTokenProvider } from '../infrastructure/jose-access-token.provider';
import { AccessTokenGuard } from './access-token.guard';
import { AuthController } from './auth.controller';
import { REFRESH_TOKEN_COOKIE_NAME } from './refresh-token.cookie';

const TEST_CONFIGURATION: AuthConfiguration = {
  jwtAccessSecret: 'http-test-access-secret-with-at-least-32-bytes',
  jwtIssuer: 'panel-ml-api-test',
  jwtAudience: 'panel-ml-test',
  accessTokenTtlSeconds: 900,
  refreshSessionTtlMs: 86_400_000,
};

const USER: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  passwordHash: '$argon2id$never-exposed',
  name: 'Test User',
  isActive: true,
  createdAt: new Date('2030-01-01T00:00:00.000Z'),
  updatedAt: new Date('2030-01-02T00:00:00.000Z'),
};

const CURRENT_REFRESH_TOKEN = 'r'.repeat(43);

const REFRESH_SESSION = {
  id: '22222222-2222-4222-8222-222222222222',
  userId: USER.id,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  revokedAt: null,
  createdAt: new Date(),
  rotatedAt: new Date(),
};

type MockedPort<T> = jest.Mocked<Pick<T, keyof T>>;

describe('AuthController HTTP', () => {
  let app: INestApplication<App>;
  let accessTokens: AccessTokenProvider;
  let users: MockedPort<UserRepository>;
  let refreshSessions: MockedPort<RefreshSessionRepository>;
  let passwordHasher: MockedPort<PasswordHasher>;

  beforeAll(async () => {
    users = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn().mockResolvedValue(USER),
    };
    refreshSessions = {
      create: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
    };
    passwordHasher = {
      hash: jest.fn(),
      verify: jest.fn(),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { ttl: 60_000, limit: 5, blockDuration: 60_000 },
        ]),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        AccessTokenGuard,
        { provide: UserRepository, useValue: users },
        { provide: RefreshSessionRepository, useValue: refreshSessions },
        { provide: PasswordHasher, useValue: passwordHasher },
        { provide: AuthConfiguration, useValue: TEST_CONFIGURATION },
        { provide: AccessTokenProvider, useClass: JoseAccessTokenProvider },
      ],
    }).compile();

    const nestApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    app = nestApp;
    accessTokens = moduleFixture.get(AccessTokenProvider);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    users.findById.mockResolvedValue(USER);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /auth/me devuelve 200 y el usuario seguro con un access JWT real', async () => {
    const issuedAt = new Date();
    const accessToken = await accessTokens.issue({
      userId: USER.id,
      refreshSessionId: '22222222-2222-4222-8222-222222222222',
      issuedAt,
      maximumExpiresAt: new Date(issuedAt.getTime() + 86_400_000),
    });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken.token}`)
      .expect(200)
      .expect({
        id: USER.id,
        email: USER.email,
        name: USER.name,
        isActive: true,
        createdAt: USER.createdAt.toISOString(),
        updatedAt: USER.updatedAt.toISOString(),
      });

    expect(users.findById).toHaveBeenCalledWith(USER.id);
  });

  it('POST /auth/login guarda el refresh en cookie HttpOnly', async () => {
    users.findByEmail.mockResolvedValue(USER);
    passwordHasher.verify.mockResolvedValue(true);
    refreshSessions.create.mockResolvedValue(REFRESH_SESSION);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: USER.email, password: 'password' })
      .expect(200);
    const body = response.body as Record<string, unknown>;

    expect(body.accessToken).toEqual(expect.any(String));
    expect(response.headers['set-cookie']?.[0]).toContain(
      `${REFRESH_TOKEN_COOKIE_NAME}=`,
    );
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('Path=/auth');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
  });

  it('POST /auth/refresh lee y rota la cookie sin exigir token en el body', async () => {
    refreshSessions.rotate.mockResolvedValue(REFRESH_SESSION);

    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE_NAME}=${CURRENT_REFRESH_TOKEN}`)
      .send({})
      .expect(200);
    const body = response.body as Record<string, unknown>;

    const rotation = refreshSessions.rotate.mock.calls[0][0];
    expect(rotation.currentRefreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rotation.nextRefreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).not.toBe(CURRENT_REFRESH_TOKEN);
    expect(response.headers['set-cookie']?.[0]).toContain(
      `${REFRESH_TOKEN_COOKIE_NAME}=`,
    );
  });

  it('limpia la cookie cuando el refresh es inválido o venció', async () => {
    refreshSessions.rotate.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE_NAME}=${CURRENT_REFRESH_TOKEN}`)
      .send({})
      .expect(401);

    expect(response.headers['set-cookie']?.[0]).toContain(
      `${REFRESH_TOKEN_COOKIE_NAME}=;`,
    );
    expect(response.headers['set-cookie']?.[0]).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
  });
});
