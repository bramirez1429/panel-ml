import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AuthService } from '../../auth/application/auth.service';
import { AuthConfiguration } from '../../auth/application/ports/auth-configuration.port';
import type { SafeUser } from '../../auth/domain/auth.models';
import { TiendanubeModule } from '../tiendanube.module';
import type { TiendanubeReplicationResult } from './tiendanube-replication-result.types';
import { TiendanubeReplicationService } from './tiendanube-replication.service';

const USER_A: SafeUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user-a@example.com',
  name: 'User A',
  isActive: true,
  createdAt: new Date('2030-01-01T00:00:00.000Z'),
  updatedAt: new Date('2030-01-02T00:00:00.000Z'),
};
const USER_B: SafeUser = {
  ...USER_A,
  id: '22222222-2222-4222-8222-222222222222',
  email: 'user-b@example.com',
  name: 'User B',
};
const APP_JWT_A = 'app-jwt-a';
const APP_JWT_B = 'app-jwt-b';
const PRODUCT_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TIENDANUBE_PRODUCT_ID_A = '987654321';
const TIENDANUBE_PRODUCT_ID_B = '123456789';
const PRIVATE_ACCESS_TOKEN = 'private-tiendanube-access-token';
const PRIVATE_CLIENT_SECRET = 'private-tiendanube-client-secret';

type AuthServiceMock = jest.Mocked<
  Pick<AuthService, 'authenticateAccessToken'>
>;
type ReplicationServiceMock = jest.Mocked<
  Pick<TiendanubeReplicationService, 'replicate'>
>;

describe('TiendanubeReplicationController HTTP', () => {
  let app: INestApplication<App>;
  let authService: AuthServiceMock;
  let replicationService: ReplicationServiceMock;

  beforeAll(async () => {
    authService = {
      authenticateAccessToken: jest.fn(),
    };
    replicationService = {
      replicate: jest.fn(),
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
      .overrideProvider(TiendanubeReplicationService)
      .useValue(replicationService)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authService.authenticateAccessToken.mockImplementation((token) => {
      if (token === APP_JWT_A) {
        return Promise.resolve({
          user: USER_A,
          refreshSessionId: 'session-a',
        });
      }
      if (token === APP_JWT_B) {
        return Promise.resolve({
          user: USER_B,
          refreshSessionId: 'session-b',
        });
      }
      return Promise.reject(
        new UnauthorizedException('Access token inválido o vencido'),
      );
    });
    replicationService.replicate.mockRejectedValue(
      new Error('Unexpected replication call'),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('sin JWT responde 401 y no invoca la replicación', async () => {
    await request(app.getHttpServer())
      .post(`/tiendanube/replication/mercadolibre/${PRODUCT_ID_A}`)
      .expect(401);

    expect(authService.authenticateAccessToken).not.toHaveBeenCalled();
    expect(replicationService.replicate).not.toHaveBeenCalled();
  });

  it('JWT A pasa el userId autenticado y el UUID exacto del path', async () => {
    const result: TiendanubeReplicationResult = {
      ok: true,
      alreadyReplicated: false,
      mlProductId: PRODUCT_ID_A,
      tiendanubeProductId: TIENDANUBE_PRODUCT_ID_A,
    };
    replicationService.replicate.mockResolvedValue(result);

    const response = await request(app.getHttpServer())
      .post(`/tiendanube/replication/mercadolibre/${PRODUCT_ID_A}`)
      .set('Authorization', `Bearer ${APP_JWT_A}`)
      .expect(201)
      .expect(result);

    expect(authService.authenticateAccessToken).toHaveBeenCalledTimes(1);
    expect(authService.authenticateAccessToken).toHaveBeenCalledWith(APP_JWT_A);
    expect(replicationService.replicate).toHaveBeenCalledTimes(1);
    expect(replicationService.replicate).toHaveBeenCalledWith(
      USER_A.id,
      PRODUCT_ID_A,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expectSafeResponse(response.body);
  });

  it('JWT B no puede forzar el usuario A mediante query ni body', async () => {
    const result: TiendanubeReplicationResult = {
      ok: true,
      alreadyReplicated: true,
      tiendanubeProductId: TIENDANUBE_PRODUCT_ID_B,
    };
    replicationService.replicate.mockResolvedValue(result);

    const response = await request(app.getHttpServer())
      .post(`/tiendanube/replication/mercadolibre/${PRODUCT_ID_B}`)
      .set('Authorization', `Bearer ${APP_JWT_B}`)
      .query({
        userId: USER_A.id,
        productId: PRODUCT_ID_A,
        accessToken: PRIVATE_ACCESS_TOKEN,
      })
      .send({
        userId: USER_A.id,
        productId: PRODUCT_ID_A,
        clientSecret: PRIVATE_CLIENT_SECRET,
      })
      .expect(201)
      .expect(result);

    expect(authService.authenticateAccessToken).toHaveBeenCalledWith(APP_JWT_B);
    expect(replicationService.replicate).toHaveBeenCalledTimes(1);
    expect(replicationService.replicate).toHaveBeenCalledWith(
      USER_B.id,
      PRODUCT_ID_B,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expectSafeResponse(response.body);
  });

  it('rechaza un productId que no sea UUID antes de invocar el servicio', async () => {
    const response = await request(app.getHttpServer())
      .post('/tiendanube/replication/mercadolibre/not-a-uuid')
      .set('Authorization', `Bearer ${APP_JWT_A}`)
      .expect(400);

    expect(authService.authenticateAccessToken).toHaveBeenCalledWith(APP_JWT_A);
    expect(replicationService.replicate).not.toHaveBeenCalled();
    expectSafeResponse(response.body);
  });
});

function expectSafeResponse(body: unknown): void {
  const serializedBody = JSON.stringify(body);

  expect(serializedBody).not.toContain(PRIVATE_ACCESS_TOKEN);
  expect(serializedBody).not.toContain(PRIVATE_CLIENT_SECRET);
  expect(serializedBody).not.toMatch(
    /access[_-]?token|authorization|client[_-]?secret/i,
  );
}
