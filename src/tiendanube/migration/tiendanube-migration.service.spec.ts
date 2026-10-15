import { ForbiddenException, GatewayTimeoutException } from '@nestjs/common';
import { readFileSync } from 'node:fs';

import type { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import type { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import type { TiendanubeSourceReplicationService } from '../replication/tiendanube-source-replication.service';
import { TiendanubeProductValidationError } from '../replication/mercadolibre-to-tiendanube.mapper';
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
    await dependencies.service.processNext(JOB_ID, currentRun());
    expect(
      dependencies.replication.replicateForMigration,
    ).toHaveBeenCalledTimes(1);
    expect(dependencies.repository.claimNextItem).toHaveBeenCalledTimes(1);
  });

  it('aprueba una creación confirmada y delega el progreso atómico al repositorio', async () => {
    const dependencies = setup();
    await dependencies.service.processNext(JOB_ID, currentRun());
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
    await dependencies.service.processNext(JOB_ID, currentRun());
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
    await dependencies.service.processNext(JOB_ID, currentRun());
    expect(dependencies.repository.retryItem).toHaveBeenCalledWith(
      'ITEM-1',
      expect.any(Number),
      expect.any(String),
    );
  });

  it('rechaza un producto inválido local y continúa con el siguiente', async () => {
    const dependencies = setup();
    dependencies.replication.replicateForMigration.mockRejectedValue(
      new TiendanubeProductValidationError('VARIANT_PRICE_INVALID'),
    );

    await expect(
      dependencies.service.processNext(JOB_ID, currentRun()),
    ).resolves.toEqual(expect.objectContaining({ hasMore: false, terminal: true }));
    expect(dependencies.repository.finishItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'ITEM-1',
        status: 'REJECTED',
        errorCode: 'MERCADOLIBRE_PRODUCT_VARIANT_PRICE_INVALID',
      }),
    );
    expect(dependencies.repository.retryItem).not.toHaveBeenCalled();
    expect(dependencies.repository.pauseJob).not.toHaveBeenCalled();
  });

  it('recupera una ejecución interrumpida reconciliando antes de crear otro producto', async () => {
    const dependencies = setup({ isReconciliation: true });
    dependencies.replication.reconcileMigration.mockResolvedValue({
      action: 'created',
      sourceKey: 'family:10',
      tiendanubeProductId: '900',
    });
    await dependencies.service.processNext(JOB_ID, currentRun());
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
    dependencies.repository.findJob.mockResolvedValue(
      job({ locked_until: new Date(Date.now() + 60_000).toISOString() }),
    );
    await expect(dependencies.service.processNext(JOB_ID, currentRun())).resolves.toEqual(
      expect.objectContaining({ hasMore: true }),
    );
    expect(
      dependencies.replication.replicateForMigration,
    ).not.toHaveBeenCalled();
  });

  it('reanuda el job existente de forma atÃ³mica y valida propietario y estado', async () => {
    const dependencies = setup();
    dependencies.repository.findJob.mockResolvedValue(
      job({ status: 'PAUSED' }),
    );
    dependencies.repository.resumeJob.mockResolvedValue('run-token');
    const resumed = await dependencies.service.resume(USER_ID, JOB_ID);
    expect(resumed.executionToken).toBe('run-token');
    expect(resumed.job.id).toBe(JOB_ID);
    expect(dependencies.repository.resumeJob).toHaveBeenCalledWith(JOB_ID);

    dependencies.repository.findJob.mockResolvedValue(
      job({ status: 'RUNNING' }),
    );
    await expect(
      dependencies.service.resume(USER_ID, JOB_ID),
    ).rejects.toThrow();
  });

  it('procesa un Ãºnico producto y pausa antes de programar otro', async () => {
    const dependencies = setup();
    await expect(
      dependencies.service.processNext(JOB_ID, {
        mode: 'SINGLE_ITEM',
        executionToken: 'execution-token',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ hasMore: false, terminal: true }),
    );
    expect(dependencies.repository.pauseJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.stringContaining('Ejecución controlada'),
    );
  });

  it('mantiene calificadas las columnas ambiguas de claim_next', () => {
    const sql = readFileSync(
      'supabase/migrations/20261015000000_create_tiendanube_migration_jobs.sql',
      'utf8',
    );
    expect(sql).toContain('migration_item.attempts + 1');
    expect(sql).toContain('where migration_item.id = v_item.id');
  });

  it('ignora un SINGLE_ITEM viejo luego de una reanudación CONTINUE', async () => {
    const dependencies = setup();
    await expect(
      dependencies.service.processNext(JOB_ID, {
        mode: 'SINGLE_ITEM',
        executionToken: 'old-token',
      }),
    ).resolves.toEqual({ hasMore: false });
    expect(dependencies.repository.claimJob).not.toHaveBeenCalled();
    expect(
      dependencies.replication.replicateForMigration,
    ).not.toHaveBeenCalled();
  });

  it('rechaza mensajes CONTINUE sin token o con un token anterior', async () => {
    const dependencies = setup();
    await expect(dependencies.service.processNext(JOB_ID)).resolves.toEqual({
      hasMore: false,
    });
    await expect(
      dependencies.service.processNext(JOB_ID, {
        mode: 'CONTINUE',
        executionToken: 'old-token',
      }),
    ).resolves.toEqual({ hasMore: false });
    expect(dependencies.repository.claimJob).not.toHaveBeenCalled();
    expect(dependencies.repository.claimNextItem).not.toHaveBeenCalled();
  });

  it('usa el presupuesto del ciclo y conserva attempts como historial', async () => {
    const dependencies = setup({ attempts: 9, cycleAttempts: 1 });
    dependencies.replication.replicateForMigration.mockRejectedValue(
      new GatewayTimeoutException(),
    );
    await dependencies.service.processNext(JOB_ID, currentRun());
    expect(dependencies.repository.retryItem).toHaveBeenCalled();
    expect(dependencies.repository.pauseJob).not.toHaveBeenCalled();
  });

  it('reconcilia un POST incierto reanudado sin usar el historial como límite', async () => {
    const dependencies = setup({
      attempts: 9,
      cycleAttempts: 1,
      isReconciliation: true,
    });
    dependencies.replication.reconcileMigration.mockResolvedValue(null);
    await dependencies.service.processNext(JOB_ID, currentRun());
    expect(dependencies.repository.waitForReconciliation).toHaveBeenCalled();
    expect(dependencies.repository.pauseJob).not.toHaveBeenCalled();
  });

  it('declara la recuperación atómica pre y post POST en la migración incremental', () => {
    const sql = readFileSync(
      'supabase/migrations/20261015020000_harden_tiendanube_migration_retries.sql',
      'utf8',
    );
    expect(sql).toContain('cycle_attempts = migration_item.cycle_attempts + 1');
    expect(sql).toContain(
      "when migration_item.post_started_at is null then 'PENDING'",
    );
    expect(sql).toContain("else 'RECONCILING'");
    expect(sql).toContain("migration_job.status = 'PAUSED'");
    expect(sql).toContain('migration_job.execution_token = p_execution_token');
    expect(sql).toContain('claim_tiendanube_migration_job_v2');
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
    await dependencies.service.processNext(JOB_ID, currentRun());
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
    await dependencies.service.processNext(JOB_ID, currentRun());
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
    resumeJob: jest.fn().mockResolvedValue(true),
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
    execution_token: 'execution-token',
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
    cycleAttempts: 1,
    isReconciliation: false,
    ...overrides,
  };
}

function currentRun() {
  return { mode: 'CONTINUE' as const, executionToken: 'execution-token' };
}
