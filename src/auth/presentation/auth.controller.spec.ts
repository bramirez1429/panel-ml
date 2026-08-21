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

type MockedPort<T> = jest.Mocked<Pick<T, keyof T>>;

describe('AuthController HTTP', () => {
  let app: INestApplication<App>;
  let accessTokens: AccessTokenProvider;
  let users: MockedPort<UserRepository>;

  beforeAll(async () => {
    users = {
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
});
