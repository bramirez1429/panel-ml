import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { TiendanubeApiService } from './shared/tiendanube-api.service';
import { TiendanubeController } from './tiendanube.controller';
import { TiendanubeModule } from './tiendanube.module';

describe('TiendanubeModule', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [TiendanubeModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('carga el módulo con su controller y cliente API', () => {
    expect(moduleFixture.get(TiendanubeController)).toBeDefined();
    expect(moduleFixture.get(TiendanubeApiService)).toBeDefined();
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
