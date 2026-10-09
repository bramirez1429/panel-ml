import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { PublicationSyncController } from './publication-sync.controller';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncQueueService } from './publication-sync-queue.service';

const USER: SafeUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'user@example.com',
  name: 'User',
  isActive: true,
  createdAt: new Date('2030-01-01T00:00:00.000Z'),
  updatedAt: new Date('2030-01-01T00:00:00.000Z'),
};
const ACTIVE_SYNC = {
  ok: true as const,
  syncId: '11111111-1111-4111-8111-111111111111',
  status: 'RUNNING' as const,
  totalItems: 42,
  processedItems: 10,
  productsSaved: 7,
  childrenSaved: 3,
  errorsCount: 1,
  lastError: null,
  hasMore: true,
};

describe('PublicationSyncController HTTP', () => {
  const getActive = jest.fn();
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [PublicationSyncController],
      providers: [
        AccessTokenGuard,
        {
          provide: PublicationSyncJobService,
          useValue: { getActive },
        },
        {
          provide: PublicationSyncQueueService,
          useValue: {},
        },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate(context: ExecutionContext): boolean {
          const httpRequest = context
            .switchToHttp()
            .getRequest<{ auth?: { user: SafeUser } }>();
          httpRequest.auth = { user: USER };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('devuelve activeSync null como JSON cuando no hay sincronización activa', async () => {
    getActive.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .get('/mercadolibre/publicaciones/sync/active')
      .expect('Content-Type', /application\/json/)
      .expect(200);

    expect(response.body).toEqual({ activeSync: null });
    expect(getActive).toHaveBeenCalledWith(USER.id);
  });

  it('devuelve activeSync completo como JSON cuando hay sincronización activa', async () => {
    getActive.mockResolvedValue(ACTIVE_SYNC);

    const response = await request(app.getHttpServer())
      .get('/mercadolibre/publicaciones/sync/active')
      .expect('Content-Type', /application\/json/)
      .expect(200);

    expect(response.body).toEqual({ activeSync: ACTIVE_SYNC });
    expect(getActive).toHaveBeenCalledWith(USER.id);
  });
});
