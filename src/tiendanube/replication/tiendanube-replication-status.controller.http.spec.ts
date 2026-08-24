import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AuthService } from '../../auth/application/auth.service';
import { AuthConfiguration } from '../../auth/application/ports/auth-configuration.port';
import type { SafeUser } from '../../auth/domain/auth.models';
import { configureApp, NEST_APPLICATION_OPTIONS } from '../../configure-app';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeModule } from '../tiendanube.module';
import { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';

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
const STORE_A = '987654';
const STORE_B = '123456';
const APP_JWT_A = 'app-jwt-a';
const APP_JWT_B = 'app-jwt-b';
const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRODUCT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRODUCT_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SECRET_MARKER = 'private-tiendanube-access-token';

type AuthServiceMock = jest.Mocked<
  Pick<AuthService, 'authenticateAccessToken'>
>;
type ConnectionRepositoryMock = jest.Mocked<
  Pick<TiendanubeConnectionRepository, 'findSummaryByUserId'>
>;
type ProductLinkRepositoryMock = jest.Mocked<
  Pick<TiendanubeProductLinkRepository, 'findStatusesByMlProductIds'>
>;

describe('GET /tiendanube/replication/status', () => {
  let app: INestApplication<App>;
  let authService: AuthServiceMock;
  let connectionRepository: ConnectionRepositoryMock;
  let productLinkRepository: ProductLinkRepositoryMock;
  const apiService = {
    get: jest.fn().mockRejectedValue(new Error('Unexpected API request')),
    post: jest.fn().mockRejectedValue(new Error('Unexpected API request')),
  };

  beforeAll(async () => {
    authService = { authenticateAccessToken: jest.fn() };
    connectionRepository = { findSummaryByUserId: jest.fn() };
    productLinkRepository = { findStatusesByMlProductIds: jest.fn() };

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
      .overrideProvider(TiendanubeConnectionRepository)
      .useValue(connectionRepository)
      .overrideProvider(TiendanubeProductLinkRepository)
      .useValue(productLinkRepository)
      .overrideProvider(TiendanubeApiService)
      .useValue(apiService)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(
      NEST_APPLICATION_OPTIONS,
    );
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authService.authenticateAccessToken.mockImplementation((token) => {
      if (token === APP_JWT_A) {
        return Promise.resolve({ user: USER_A, refreshSessionId: 'session-a' });
      }
      if (token === APP_JWT_B) {
        return Promise.resolve({ user: USER_B, refreshSessionId: 'session-b' });
      }
      return Promise.reject(
        new UnauthorizedException('Access token inválido o vencido'),
      );
    });
    connectionRepository.findSummaryByUserId.mockImplementation((userId) => {
      if (userId === USER_A.id) {
        return Promise.resolve({
          storeId: STORE_A,
          scope: 'write_products',
          accessToken: SECRET_MARKER,
        } as unknown as { storeId: string; scope: string });
      }
      if (userId === USER_B.id) {
        return Promise.resolve({
          storeId: STORE_B,
          scope: 'write_products',
        });
      }
      return Promise.resolve(null);
    });
    productLinkRepository.findStatusesByMlProductIds.mockRejectedValue(
      new Error('Unexpected link status read'),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('requiere JWT y no consulta conexiones ni vínculos', async () => {
    await request(app.getHttpServer())
      .get('/tiendanube/replication/status')
      .query({ productIds: PRODUCT_A })
      .expect(401);

    expect(connectionRepository.findSummaryByUserId).not.toHaveBeenCalled();
    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).not.toHaveBeenCalled();
  });

  it('devuelve todos los estados en orden, deduplica y no expone tokens', async () => {
    productLinkRepository.findStatusesByMlProductIds.mockResolvedValue([
      {
        mlProductId: PRODUCT_C,
        status: 'COMPLETED',
        tiendanubeProductId: '362983603',
        accessToken: SECRET_MARKER,
      },
      {
        mlProductId: PRODUCT_B,
        status: 'FAILED',
        tiendanubeProductId: null,
      },
      {
        mlProductId: PRODUCT_A,
        status: 'PENDING',
        tiendanubeProductId: null,
      },
    ] as unknown as Awaited<
      ReturnType<TiendanubeProductLinkRepository['findStatusesByMlProductIds']>
    >);

    const response = await request(app.getHttpServer())
      .get('/tiendanube/replication/status')
      .set('Authorization', `Bearer ${APP_JWT_A}`)
      .query({
        productIds: `${PRODUCT_D},${PRODUCT_A},${PRODUCT_B},${PRODUCT_C},${PRODUCT_A}`,
      })
      .expect(200)
      .expect({
        items: [
          { mlProductId: PRODUCT_D, status: 'NOT_REPLICATED' },
          { mlProductId: PRODUCT_A, status: 'PENDING' },
          { mlProductId: PRODUCT_B, status: 'FAILED' },
          {
            mlProductId: PRODUCT_C,
            status: 'COMPLETED',
            tiendanubeProductId: '362983603',
          },
        ],
      });

    expect(connectionRepository.findSummaryByUserId).toHaveBeenCalledWith(
      USER_A.id,
    );
    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).toHaveBeenCalledTimes(1);
    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).toHaveBeenCalledWith({
      userId: USER_A.id,
      storeId: STORE_A,
      mlProductIds: [PRODUCT_D, PRODUCT_A, PRODUCT_B, PRODUCT_C],
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toMatch(
      /access[_-]?token|authorization|client[_-]?secret|private-/i,
    );
    expect(apiService.get).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('el usuario B no puede consultar vínculos usando identidad de A', async () => {
    productLinkRepository.findStatusesByMlProductIds.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/tiendanube/replication/status')
      .set('Authorization', `Bearer ${APP_JWT_B}`)
      .query({ productIds: PRODUCT_A })
      .expect(200)
      .expect({
        items: [{ mlProductId: PRODUCT_A, status: 'NOT_REPLICATED' }],
      });

    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).toHaveBeenCalledWith({
      userId: USER_B.id,
      storeId: STORE_B,
      mlProductIds: [PRODUCT_A],
    });
  });

  it.each([
    ['sin lista', undefined],
    ['lista vacía', ''],
    ['UUID inválido', 'not-a-uuid'],
    ['segmento vacío', `${PRODUCT_A},`],
    ['más de 100 IDs', makeProductIds(101)],
    [
      'más de 100 IDs duplicados',
      Array.from({ length: 101 }, () => PRODUCT_A).join(','),
    ],
  ])('rechaza 400 %s', async (_name, productIds) => {
    const httpRequest = request(app.getHttpServer())
      .get('/tiendanube/replication/status')
      .set('Authorization', `Bearer ${APP_JWT_A}`);
    if (productIds !== undefined) httpRequest.query({ productIds });

    await httpRequest.expect(400);
    expect(connectionRepository.findSummaryByUserId).not.toHaveBeenCalled();
    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).not.toHaveBeenCalled();
  });

  it('rechaza productIds repetido como query array y campos de identidad extra', async () => {
    await request(app.getHttpServer())
      .get(
        `/tiendanube/replication/status?productIds=${PRODUCT_A}&productIds=${PRODUCT_B}`,
      )
      .set('Authorization', `Bearer ${APP_JWT_A}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/tiendanube/replication/status')
      .set('Authorization', `Bearer ${APP_JWT_A}`)
      .query({ productIds: PRODUCT_A, userId: USER_B.id })
      .expect(400);

    expect(connectionRepository.findSummaryByUserId).not.toHaveBeenCalled();
    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).not.toHaveBeenCalled();
  });
});

function makeProductIds(count: number): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
  ).join(',');
}
