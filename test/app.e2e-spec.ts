import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AuthConfiguration } from './../src/auth/application/ports/auth-configuration.port';
import { configureApp } from './../src/configure-app';

const TEST_AUTH_CONFIGURATION: AuthConfiguration = {
  jwtAccessSecret: 'e2e-test-access-secret-with-at-least-32-bytes',
  jwtIssuer: 'panel-ml-api-e2e',
  jwtAudience: 'panel-ml-e2e',
  accessTokenTtlSeconds: 900,
  refreshSessionTtlMs: 86_400_000,
};

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthConfiguration)
      .useValue(TEST_AUTH_CONFIGURATION)
      .compile();

    const nestApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(nestApp);
    app = nestApp;
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
