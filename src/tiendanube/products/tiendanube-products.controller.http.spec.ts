import {
  BadGatewayException,
  type INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AuthService } from '../../auth/application/auth.service';
import { AuthConfiguration } from '../../auth/application/ports/auth-configuration.port';
import type { SafeUser } from '../../auth/domain/auth.models';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeModule } from '../tiendanube.module';

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
const STORE_A = '987654';
const STORE_B = '123456';
const TIENDANUBE_TOKEN_A = 'private-tiendanube-token-a';
const TIENDANUBE_TOKEN_B = 'private-tiendanube-token-b';
const CLIENT_SECRET_MARKER = 'private-client-secret';

const UPSTREAM_PRODUCT_A = {
  id: 1001,
  name: { es: 'Producto A' },
  published: true,
  variants: [
    {
      id: 1101,
      sku: 'PRIVATE-SKU-A',
      access_token: TIENDANUBE_TOKEN_A,
    },
  ],
  images: [
    {
      id: 1201,
      src: 'https://example.com/product-a.jpg',
      position: 1,
      client_secret: CLIENT_SECRET_MARKER,
    },
  ],
  access_token: TIENDANUBE_TOKEN_A,
};
const PRODUCT_A = {
  id: 1001,
  name: { es: 'Producto A' },
  published: true,
  variants: [{ id: 1101 }],
  images: [
    {
      id: 1201,
      src: 'https://example.com/product-a.jpg',
      position: 1,
    },
  ],
};
const UPSTREAM_PRODUCT_B = {
  id: 2001,
  name: { es: 'Producto B' },
  published: false,
  variants: [],
  images: [],
  authorization: `Bearer ${TIENDANUBE_TOKEN_B}`,
};
const PRODUCT_B = {
  id: 2001,
  name: { es: 'Producto B' },
  published: false,
  variants: [],
  images: [],
};

type AuthServiceMock = jest.Mocked<
  Pick<AuthService, 'authenticateAccessToken'>
>;
type ConnectionRepositoryMock = jest.Mocked<
  Pick<
    TiendanubeConnectionRepository,
    | 'saveConnection'
    | 'findSummaryByUserId'
    | 'findCredentialsByUserId'
    | 'deleteByStoreId'
  >
>;
type ApiServiceMock = jest.Mocked<Pick<TiendanubeApiService, 'get'>>;

describe('TiendanubeProductsController HTTP', () => {
  let app: INestApplication<App>;
  let authService: AuthServiceMock;
  let connectionRepository: ConnectionRepositoryMock;
  let apiService: ApiServiceMock;

  beforeAll(async () => {
    authService = {
      authenticateAccessToken: jest.fn(),
    };
    connectionRepository = {
      saveConnection: jest.fn(),
      findSummaryByUserId: jest.fn(),
      findCredentialsByUserId: jest.fn(),
      deleteByStoreId: jest.fn(),
    };
    apiService = {
      get: jest.fn(),
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
      .overrideProvider(TiendanubeConnectionRepository)
      .useValue(connectionRepository)
      .overrideProvider(TiendanubeApiService)
      .useValue(apiService)
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
    connectionRepository.findCredentialsByUserId.mockRejectedValue(
      new Error('Unexpected connection lookup'),
    );
    apiService.get.mockRejectedValue(
      new Error('Unexpected Tiendanube API call'),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('requiere el JWT de nuestra aplicación antes de consultar credenciales', async () => {
    await request(app.getHttpServer()).get('/tiendanube/products').expect(401);

    expect(authService.authenticateAccessToken).not.toHaveBeenCalled();
    expect(connectionRepository.findCredentialsByUserId).not.toHaveBeenCalled();
    expect(apiService.get).not.toHaveBeenCalled();
  });

  it('rechaza un JWT inválido sin consultar conexión ni Tiendanube', async () => {
    await request(app.getHttpServer())
      .get('/tiendanube/products')
      .set('Authorization', 'Bearer invalid-app-jwt')
      .expect(401);

    expect(authService.authenticateAccessToken).toHaveBeenCalledWith(
      'invalid-app-jwt',
    );
    expect(connectionRepository.findCredentialsByUserId).not.toHaveBeenCalled();
    expect(apiService.get).not.toHaveBeenCalled();
  });

  it('aísla usuarios A/B y usa sus credenciales internas en /products', async () => {
    connectionRepository.findCredentialsByUserId.mockImplementation((userId) =>
      Promise.resolve(
        userId === USER_A.id
          ? {
              storeId: STORE_A,
              accessToken: TIENDANUBE_TOKEN_A,
              scope: 'read_products',
            }
          : {
              storeId: STORE_B,
              accessToken: TIENDANUBE_TOKEN_B,
              scope: 'read_products',
            },
      ),
    );
    apiService.get
      .mockResolvedValueOnce([UPSTREAM_PRODUCT_A])
      .mockResolvedValueOnce([UPSTREAM_PRODUCT_B]);

    const responseA = await request(app.getHttpServer())
      .get('/tiendanube/products')
      .set('Authorization', `Bearer ${APP_JWT_A}`)
      .query({
        userId: USER_B.id,
        storeId: STORE_B,
        accessToken: TIENDANUBE_TOKEN_B,
      })
      .expect(200)
      .expect([PRODUCT_A]);
    const responseB = await request(app.getHttpServer())
      .get('/tiendanube/products')
      .set('Authorization', `Bearer ${APP_JWT_B}`)
      .query({
        userId: USER_A.id,
        storeId: STORE_A,
        accessToken: TIENDANUBE_TOKEN_A,
      })
      .expect(200)
      .expect([PRODUCT_B]);

    expect(authService.authenticateAccessToken).toHaveBeenNthCalledWith(
      1,
      APP_JWT_A,
    );
    expect(authService.authenticateAccessToken).toHaveBeenNthCalledWith(
      2,
      APP_JWT_B,
    );
    expect(
      connectionRepository.findCredentialsByUserId,
    ).toHaveBeenNthCalledWith(1, USER_A.id);
    expect(
      connectionRepository.findCredentialsByUserId,
    ).toHaveBeenNthCalledWith(2, USER_B.id);
    expect(apiService.get).toHaveBeenNthCalledWith(
      1,
      STORE_A,
      '/products',
      TIENDANUBE_TOKEN_A,
    );
    expect(apiService.get).toHaveBeenNthCalledWith(
      2,
      STORE_B,
      '/products',
      TIENDANUBE_TOKEN_B,
    );
    expect(responseA.headers['cache-control']).toBe('no-store');
    expect(responseB.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(responseA.body)).not.toContain(PRODUCT_B.name.es);
    expect(JSON.stringify(responseB.body)).not.toContain(PRODUCT_A.name.es);
    expectResponsesDoNotExposeSecrets(responseA.body, responseB.body);
  });

  it('sin conexión devuelve un error controlado y no llama a Tiendanube', async () => {
    connectionRepository.findCredentialsByUserId.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .get('/tiendanube/products')
      .set('Authorization', `Bearer ${APP_JWT_B}`)
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
    });
    expect(JSON.stringify(response.body)).toContain('/tiendanube/connect');
    expect(connectionRepository.findCredentialsByUserId).toHaveBeenCalledTimes(
      1,
    );
    expect(connectionRepository.findCredentialsByUserId).toHaveBeenCalledWith(
      USER_B.id,
    );
    expect(apiService.get).not.toHaveBeenCalled();
    expectResponsesDoNotExposeSecrets(response.body);
  });

  it('propaga un error API controlado sin filtrar credenciales', async () => {
    connectionRepository.findCredentialsByUserId.mockResolvedValue({
      storeId: STORE_A,
      accessToken: TIENDANUBE_TOKEN_A,
      scope: 'read_products',
    });
    apiService.get.mockRejectedValue(
      new BadGatewayException('No se pudo conectar con Tiendanube'),
    );

    const response = await request(app.getHttpServer())
      .get('/tiendanube/products')
      .set('Authorization', `Bearer ${APP_JWT_A}`)
      .expect(502);

    expect(response.body).toMatchObject({
      statusCode: 502,
      message: 'No se pudo conectar con Tiendanube',
    });
    expect(apiService.get).toHaveBeenCalledTimes(1);
    expect(apiService.get).toHaveBeenCalledWith(
      STORE_A,
      '/products',
      TIENDANUBE_TOKEN_A,
    );
    expectResponsesDoNotExposeSecrets(response.body);
  });
});

function expectResponsesDoNotExposeSecrets(...bodies: readonly unknown[]) {
  const serializedBodies = JSON.stringify(bodies);

  expect(serializedBodies).not.toContain(TIENDANUBE_TOKEN_A);
  expect(serializedBodies).not.toContain(TIENDANUBE_TOKEN_B);
  expect(serializedBodies).not.toContain(CLIENT_SECRET_MARKER);
  expect(serializedBodies).not.toMatch(
    /access[_-]?token|authorization|client[_-]?secret/i,
  );
}
