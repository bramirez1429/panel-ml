import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AuthConfiguration } from '../auth/application/ports/auth-configuration.port';
import { TiendanubeOAuthService } from './auth/tiendanube-oauth.service';
import { SupabaseTiendanubeConnectionRepository } from './connections/supabase-tiendanube-connection.repository';
import { TiendanubeConnectionRepository } from './connections/tiendanube-connection.repository';
import { TiendanubeConnectionService } from './connections/tiendanube-connection.service';
import { TiendanubeApiService } from './shared/tiendanube-api.service';
import { TiendanubeController } from './tiendanube.controller';
import { TiendanubeModule } from './tiendanube.module';
import { TiendanubePrivacyWebhookController } from './webhooks/tiendanube-privacy-webhook.controller';
import { TiendanubePrivacyWebhookService } from './webhooks/tiendanube-privacy-webhook.service';

describe('TiendanubeModule', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TiendanubeModule,
      ],
    })
      .overrideProvider(AuthConfiguration)
      .useValue({
        jwtAccessSecret: 'test-secret-with-at-least-32-bytes',
        jwtIssuer: 'panel-ml-api-test',
        jwtAudience: 'panel-ml-test',
        accessTokenTtlSeconds: 900,
        refreshSessionTtlMs: 86_400_000,
      })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('carga el módulo con su controller y cliente API', () => {
    expect(moduleFixture.get(TiendanubeController)).toBeDefined();
    expect(moduleFixture.get(TiendanubeApiService)).toBeDefined();
    expect(moduleFixture.get(TiendanubeOAuthService)).toBeDefined();
    expect(moduleFixture.get(TiendanubeConnectionRepository)).toBeInstanceOf(
      SupabaseTiendanubeConnectionRepository,
    );
    expect(moduleFixture.get(TiendanubeConnectionService)).toBeDefined();
    expect(moduleFixture.get(TiendanubePrivacyWebhookController)).toBeDefined();
    expect(moduleFixture.get(TiendanubePrivacyWebhookService)).toBeDefined();
  });

  it('expone GET /tiendanube/health con estado 200', async () => {
    await request(app.getHttpServer())
      .get('/tiendanube/health')
      .expect(200)
      .expect({ ok: true, service: 'tiendanube' });
  });

  it('no expone configuración sensible en health', async () => {
    const response = await request(app.getHttpServer())
      .get('/tiendanube/health')
      .expect(200);
    const serializedBody = JSON.stringify(response.body);

    expect(serializedBody).not.toMatch(
      /client[_-]?id|client[_-]?secret|access[_-]?token|authorization/i,
    );
  });
});
