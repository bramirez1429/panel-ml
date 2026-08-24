import { createHmac } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp, NEST_APPLICATION_OPTIONS } from '../../configure-app';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubePrivacyWebhookController } from './tiendanube-privacy-webhook.controller';
import { TiendanubePrivacyWebhookService } from './tiendanube-privacy-webhook.service';

const CLIENT_SECRET = 'test-tiendanube-client-secret';
const ACCESS_TOKEN = 'test-tiendanube-access-token';
const HMAC_HEADER = 'x-linkedstore-hmac-sha256';

const STORE_REDACT_ROUTE = '/tiendanube/webhooks/store-redact';
const CUSTOMER_ROUTES = [
  '/tiendanube/webhooks/customers-redact',
  '/tiendanube/webhooks/customers-data-request',
] as const;
const PRIVACY_ROUTES = [STORE_REDACT_ROUTE, ...CUSTOMER_ROUTES] as const;

type ConnectionRepositoryMock = jest.Mocked<
  Pick<
    TiendanubeConnectionRepository,
    'saveConnection' | 'findSummaryByUserId' | 'deleteByStoreId'
  >
>;

describe('TiendanubePrivacyWebhookController HTTP', () => {
  let app: INestApplication<App>;
  let connectionRepository: ConnectionRepositoryMock;

  beforeAll(async () => {
    connectionRepository = {
      saveConnection: jest.fn(),
      findSummaryByUserId: jest.fn(),
      deleteByStoreId: jest.fn(),
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({
              TIENDANUBE_CLIENT_SECRET: CLIENT_SECRET,
            }),
          ],
        }),
      ],
      controllers: [TiendanubePrivacyWebhookController],
      providers: [
        TiendanubePrivacyWebhookService,
        {
          provide: TiendanubeConnectionRepository,
          useValue: connectionRepository,
        },
      ],
    }).compile();

    const nestApp = moduleFixture.createNestApplication<NestExpressApplication>(
      NEST_APPLICATION_OPTIONS,
    );
    configureApp(nestApp);
    app = nestApp;
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    connectionRepository.deleteByStoreId.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('acepta store-redact sin JWT y elimina exactamente el store firmado', async () => {
    const rawBody = '{\n  "store_id": 987654,\n  "reason": "app removed"\n}';

    await postSigned(STORE_REDACT_ROUTE, rawBody)
      .expect(200)
      .expect({ ok: true });

    expect(connectionRepository.deleteByStoreId).toHaveBeenCalledTimes(1);
    expect(connectionRepository.deleteByStoreId).toHaveBeenCalledWith('987654');
    expect(connectionRepository.saveConnection).not.toHaveBeenCalled();
    expect(connectionRepository.findSummaryByUserId).not.toHaveBeenCalled();
  });

  it.each(CUSTOMER_ROUTES)(
    'acepta %s sin JWT y no modifica conexiones',
    async (route) => {
      const rawBody =
        '{\n  "store_id": "987654",\n  "customer": { "id": 12345 }\n}';

      await postSigned(route, rawBody).expect(200).expect({ ok: true });

      expect(connectionRepository.deleteByStoreId).not.toHaveBeenCalled();
      expect(connectionRepository.saveConnection).not.toHaveBeenCalled();
      expect(connectionRepository.findSummaryByUserId).not.toHaveBeenCalled();
    },
  );

  it.each(PRIVACY_ROUTES)(
    'rechaza con 400 un payload firmado pero inválido en %s',
    async (route) => {
      const rawBody = '{}';

      const response = await postSigned(route, rawBody).expect(400);

      expect(response.body).toMatchObject({ statusCode: 400 });
      expect(connectionRepository.deleteByStoreId).not.toHaveBeenCalled();
    },
  );

  it.each(PRIVACY_ROUTES)(
    'rechaza con 401 la firma inválida en %s',
    async (route) => {
      const rawBody = validBodyFor(route);

      const response = await request(app.getHttpServer())
        .post(route)
        .set('Content-Type', 'application/json')
        .set(HMAC_HEADER, '0'.repeat(64))
        .send(rawBody)
        .expect(401);

      expect(response.body).toMatchObject({ statusCode: 401 });
      expect(connectionRepository.deleteByStoreId).not.toHaveBeenCalled();
    },
  );

  it.each(PRIVACY_ROUTES)(
    'rechaza con 401 una firma ausente en %s',
    async (route) => {
      const response = await request(app.getHttpServer())
        .post(route)
        .set('Content-Type', 'application/json')
        .send(validBodyFor(route))
        .expect(401);

      expect(response.body).toMatchObject({ statusCode: 401 });
      expect(connectionRepository.deleteByStoreId).not.toHaveBeenCalled();
    },
  );

  it('no refleja secretos, tokens, firma ni datos privados en la respuesta', async () => {
    const rawBody = JSON.stringify({
      store_id: 987654,
      customer: {
        id: 12345,
        email: 'private-customer@example.com',
      },
      client_secret: CLIENT_SECRET,
      access_token: ACCESS_TOKEN,
    });
    const signature = sign(rawBody);

    const response = await request(app.getHttpServer())
      .post('/tiendanube/webhooks/customers-redact')
      .set('Content-Type', 'application/json')
      .set(HMAC_HEADER, signature)
      .send(rawBody)
      .expect(200)
      .expect({ ok: true });
    const serializedBody = JSON.stringify(response.body);

    expect(serializedBody).not.toContain(CLIENT_SECRET);
    expect(serializedBody).not.toContain(ACCESS_TOKEN);
    expect(serializedBody).not.toContain(signature);
    expect(serializedBody).not.toContain('private-customer@example.com');
    expect(serializedBody).not.toMatch(
      /client[_-]?secret|access[_-]?token|authorization/i,
    );
  });

  function postSigned(route: string, rawBody: string) {
    return request(app.getHttpServer())
      .post(route)
      .set('Content-Type', 'application/json')
      .set(HMAC_HEADER, sign(rawBody))
      .send(rawBody);
  }
});

function sign(rawBody: string): string {
  return createHmac('sha256', CLIENT_SECRET)
    .update(Buffer.from(rawBody, 'utf8'))
    .digest('hex');
}

function validBodyFor(route: (typeof PRIVACY_ROUTES)[number]): string {
  if (route === STORE_REDACT_ROUTE) return '{"store_id":987654}';
  return '{"store_id":987654,"customer":{"id":12345}}';
}
