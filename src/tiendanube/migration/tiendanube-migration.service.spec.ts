import { ForbiddenException, GatewayTimeoutException } from '@nestjs/common';

import type { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import type { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import type { TiendanubeSourceReplicationService } from '../replication/tiendanube-source-replication.service';
import type { TiendanubeMigrationDiscoveryService } from './tiendanube-migration-discovery.service';
import type { SupabaseTiendanubeMigrationRepository } from './supabase-tiendanube-migration.repository';
import { TiendanubeMigrationService } from './tiendanube-migration.service';
import type { TiendanubeMigrationJob } from './tiendanube-migration.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

describe('TiendanubeMigrationService', () => {
  it.each([1, 5, 10] as const)(
    'prepara una corrida controlada de %i productos lógicos',
    async (testLimit) => {
      const dependencies = setup();
      dependencies.repository.createOrGetActive.mockResolvedValue(
        job({ test_limit: testLimit }),
      );

      await dependencies.service.start(USER_ID, testLimit);

      expect(dependencies.repository.createOrGetActive).toHaveBeenCalledWith(
        expect.objectContaining({ testLimit }),
      );
    },
  );

  it('procesa una sola publicación lógica por invocación', async () => {
    const dependencies = setup();
    await dependencies.service.processNext(JOB_ID);
    expect(
      dependencies.replication.replicateForMigration,
    ).toHaveBeenCalledTimes(1);
    expect(dependencies.repository.claimNextItem).toHaveBeenCalledTimes(1);
  });

  it('aprueba una creación confirmada y delega el progreso atómico al repositorio', async () => {
    const dependencies = setup();
    await dependencies.service.processNext(JOB_ID);
    expect(dependencies.repository.finishItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'ITEM-1',
        status: 'APPROVED',
        outcome: 'CREATED',
        tiendanubeProductId: '900',
      }),
    );
  });

  it('registra coincidencias no vinculadas como rechazadas para revisión', async () => {
    const dependencies = setup();
    dependencies.replication.replicateForMigration.mockResolvedValue({
      action: 'review-required',
      sourceKey: 'family:10',
      tiendanubeProductId: '777',
    });
    await dependencies.service.processNext(JOB_ID);
    expect(dependencies.repository.finishItem).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'REJECTED',
        errorCode: 'POSSIBLE_MATCH_REVIEW',
      }),
    );
  });

  it('reintenta un error temporal anterior al POST con backoff', async () => {
    const dependencies = setup();
    dependencies.replication.replicateForMigration.mockRejectedValue(
      new GatewayTimeoutException(),
    );
    await dependencies.service.processNext(JOB_ID);
    expect(dependencies.repository.retryItem).toHaveBeenCalledWith(
      'ITEM-1',
      30,
      expect.any(String),
    );
  });

  it('recupera una ejecución interrumpida reconciliando antes de crear otro producto', async () => {
    const dependencies = setup({ isReconciliation: true });
    dependencies.replication.reconcileMigration.mockResolvedValue({
      action: 'created',
      sourceKey: 'family:10',
      tiendanubeProductId: '900',
    });
    await dependencies.service.processNext(JOB_ID);
    expect(
      dependencies.replication.replicateForMigration,
    ).not.toHaveBeenCalled();
    expect(dependencies.replication.reconcileMigration).toHaveBeenCalledWith(
      USER_ID,
      'family:10',
    );
  });

  it('ignora entregas duplicadas cuando el lease ya está tomado', async () => {
    const dependencies = setup();
    dependencies.repository.claimJob.mockResolvedValue(false);
    await expect(dependencies.service.processNext(JOB_ID)).resolves.toEqual({
      hasMore: false,
    });
    expect(
      dependencies.replication.replicateForMigration,
    ).not.toHaveBeenCalled();
  });

  it('no repite un POST incierto y pasa a reconciliación', async () => {
    const dependencies = setup();
    dependencies.replication.replicateForMigration.mockImplementation(
      async (
        _user: string,
        _source: string,
        execution: { beforeCreate: () => Promise<void> },
      ) => {
        await execution.beforeCreate();
        throw new GatewayTimeoutException();
      },
    );
    await dependencies.service.processNext(JOB_ID);
    expect(dependencies.repository.markPostStarted).toHaveBeenCalledWith(
      'ITEM-1',
    );
    expect(dependencies.repository.waitForReconciliation).toHaveBeenCalledWith(
      'ITEM-1',
      60,
      expect.any(String),
    );
    expect(dependencies.repository.retryItem).not.toHaveBeenCalled();
  });

  it('mantiene los resultados ALREADY_EXISTS como aprobados sin actualizar el producto', async () => {
    const dependencies = setup();
    dependencies.replication.replicateForMigration.mockResolvedValue({
      action: 'already-exists',
      sourceKey: 'family:10',
      tiendanubeProductId: '900',
    });
    await dependencies.service.processNext(JOB_ID);
    expect(dependencies.repository.finishItem).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'APPROVED',
        outcome: 'ALREADY_EXISTS',
      }),
    );
  });

  it('requiere que usuario, seller y tienda sean dueños del job', async () => {
    const dependencies = setup();
    dependencies.repository.findJob.mockResolvedValue(
      job({ user_id: 'other-user' }),
    );
    await expect(
      dependencies.service.getJob(USER_ID, JOB_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function setup(itemOverrides: Record<string, unknown> = {}) {
  const repository = {
    findJob: jest.fn().mockResolvedValue(job()),
    claimJob: jest.fn().mockResolvedValue(true),
    claimNextItem: jest.fn().mockResolvedValue(claimedItem(itemOverrides)),
    markPostStarted: jest.fn().mockResolvedValue(undefined),
    finishItem: jest.fn().mockResolvedValue(undefined),
    retryItem: jest.fn().mockResolvedValue(undefined),
    waitForReconciliation: jest.fn().mockResolvedValue(undefined),
    pauseJob: jest.fn().mockResolvedValue(undefined),
    completeEmptyJob: jest.fn().mockResolvedValue(undefined),
    createOrGetActive: jest.fn(),
    findActive: jest.fn(),
    recordDiscoveryPage: jest.fn(),
    retryDiscovery: jest.fn(),
    listItems: jest.fn(),
  };
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
    getValidAccessToken: jest.fn(),
  };
  const connection = {
    findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({
      storeId: '123',
      accessToken: 'token',
      userId: USER_ID,
    }),
  };
  const discovery = { discoverPage: jest.fn() };
  const replication = {
    replicateForMigration: jest.fn().mockResolvedValue({
      action: 'created',
      sourceKey: 'family:10',
      tiendanubeProductId: '900',
    }),
    reconcileMigration: jest.fn(),
  };
  return {
    repository,
    replication,
    service: new TiendanubeMigrationService(
      repository as unknown as SupabaseTiendanubeMigrationRepository,
      token as unknown as MercadolibreTokenService,
      connection as unknown as TiendanubeConnectionRepository,
      discovery as unknown as TiendanubeMigrationDiscoveryService,
      replication as unknown as TiendanubeSourceReplicationService,
    ),
  };
}

function job(
  overrides: Partial<TiendanubeMigrationJob> = {},
): TiendanubeMigrationJob {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    seller_id: 42,
    store_id: '123',
    status: 'RUNNING',
    total_items: 1,
    processed_items: 0,
    approved_items: 0,
    rejected_items: 0,
    current_source_key: null,
    test_limit: null,
    scan_scroll_id: null,
    locked_until: null,
    next_run_at: null,
    error_message: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    ...overrides,
  };
}

function claimedItem(overrides: Record<string, unknown>) {
  return {
    id: 'ITEM-1',
    sourceKey: 'family:10',
    title: 'Producto',
    mlaIds: ['MLA1'],
    familyId: '10',
    mlauIds: ['MLAU1'],
    attempts: 1,
    isReconciliation: false,
    ...overrides,
  };
}
