import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AuthService } from './auth/application/auth.service';
import { AccessTokenGuard } from './auth/presentation/access-token.guard';
import { AppModule } from './app.module';

describe('AppModule', () => {
  let app: INestApplication<App>;
  const environmentKeys = [
    'JWT_ACCESS_SECRET',
    'JWT_ISSUER',
    'JWT_AUDIENCE',
    'JWT_ACCESS_TTL',
    'AUTH_SESSION_TTL',
  ] as const;
  const previousEnvironment = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const key of environmentKeys) {
      previousEnvironment.set(key, process.env[key]);
    }
    Object.assign(process.env, {
      JWT_ACCESS_SECRET: 'app-module-test-secret-with-at-least-32-bytes',
      JWT_ISSUER: 'panel-ml-api-test',
      JWT_AUDIENCE: 'panel-ml-test',
      JWT_ACCESS_TTL: '15m',
      AUTH_SESSION_TTL: '24h',
    });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const key of environmentKeys) {
      const value = previousEnvironment.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('compila e inicializa AuthModule y MercadolibreModule sin duplicar AuthService', () => {
    expect(app).toBeDefined();
    const authService = app.get(AuthService);
    const guard = app.get(AccessTokenGuard);

    expect(authService).toBeDefined();
    expect(guard.authService).toBe(authService);
  });
});
