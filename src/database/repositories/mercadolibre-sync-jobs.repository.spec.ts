import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../database.types';
import { SupabaseService } from '../supabase.service';
import { MercadolibreSyncJobsRepository } from './mercadolibre-sync-jobs.repository';

type SyncJobRow = Database['public']['Tables']['mercadolibre_sync_jobs']['Row'];

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const FULL_SYNC_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-10T12:00:00.000Z';

/** Crea una fila completa con el estado solicitado. */
function jobRow(status: SyncJobRow['status'] = 'PENDING'): SyncJobRow {
  return {
    id: JOB_ID,
    seller_id: 123,
    full_sync_id: FULL_SYNC_ID,
    status,
    scan_started: false,
    scroll_id: null,
    buffer_item_ids: [],
    processed_items: 0,
    products_saved: 0,
    children_saved: 0,
    errors_count: 0,
    retry_count: 0,
    last_error: null,
    started_at: null,
    finished_at: null,
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  };
}

/** Crea el repository con una tabla Supabase simulada. */
function setup(table: object) {
  const from = jest.fn().mockReturnValue(table);
  const client = { from } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;
  return { repository: new MercadolibreSyncJobsRepository(supabase), from };
}

/** Simula la cadena usada por transiciones condicionales. */
function transitionSetup(data: SyncJobRow | null, error: unknown = null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error });
  const select = jest.fn().mockReturnValue({ maybeSingle });
  const statusEq = jest.fn().mockReturnValue({ select });
  const idEq = jest.fn().mockReturnValue({ eq: statusEq });
  const update = jest.fn().mockReturnValue({ eq: idEq });
  return { ...setup({ update }), update, idEq, statusEq };
}

describe('MercadolibreSyncJobsRepository', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('crea y busca un trabajo por UUID', async () => {
    const row = jobRow();
    const single = jest.fn().mockResolvedValue({ data: row, error: null });
    const createSelect = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select: createSelect });
    const maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const { repository, from } = setup({ insert, select });

    const created = await repository.create({
      id: JOB_ID,
      sellerId: 123,
      fullSyncId: FULL_SYNC_ID,
    });
    const found = await repository.findById(JOB_ID);

    expect(created).toEqual(row);
    expect(found).toEqual(row);
    expect(from).toHaveBeenCalledWith('mercadolibre_sync_jobs');
    expect(insert).toHaveBeenCalledWith({
      id: JOB_ID,
      seller_id: 123,
      full_sync_id: FULL_SYNC_ID,
    });
    expect(eq).toHaveBeenCalledWith('id', JOB_ID);
  });

  it('reclama solamente un trabajo PENDING', async () => {
    const claimed = {
      ...jobRow('RUNNING'),
      started_at: '2026-08-10T01:00:00.000Z',
    };
    const { repository, update, idEq, statusEq } = transitionSetup(claimed);

    await expect(repository.claim(JOB_ID, null)).resolves.toEqual(claimed);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RUNNING',
        started_at: NOW,
      }),
    );
    expect(idEq).toHaveBeenCalledWith('id', JOB_ID);
    expect(statusEq).toHaveBeenCalledWith('status', 'PENDING');
  });

  it('informa conflicto cuando otra llamada ya cambió el estado', async () => {
    const { repository } = transitionSetup(null);

    await expect(repository.claim(JOB_ID, null)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('guarda progreso absoluto y libera RUNNING como PENDING', async () => {
    const pending = {
      ...jobRow(),
      scan_started: true,
      scroll_id: 'scroll-2',
      buffer_item_ids: ['MLA11'],
      processed_items: 10,
      products_saved: 4,
      children_saved: 6,
      errors_count: 1,
    };
    const { repository, update, statusEq } = transitionSetup(pending);

    await repository.updateProgress(JOB_ID, {
      scanStarted: true,
      scrollId: 'scroll-2',
      bufferItemIds: ['MLA11'],
      processedItems: 10,
      productsSaved: 4,
      childrenSaved: 6,
      errorsCount: 1,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING',
        scan_started: true,
        scroll_id: 'scroll-2',
        buffer_item_ids: ['MLA11'],
        processed_items: 10,
        products_saved: 4,
        children_saved: 6,
        errors_count: 1,
        retry_count: 0,
      }),
    );
    expect(statusEq).toHaveBeenCalledWith('status', 'RUNNING');
  });

  it('guarda el reintento temporal y libera RUNNING como PENDING', async () => {
    const pending = {
      ...jobRow(),
      retry_count: 2,
      last_error: 'Error temporal',
    };
    const { repository, update, statusEq } = transitionSetup(pending);

    await expect(
      repository.releaseAfterError(JOB_ID, 'Error temporal', 2),
    ).resolves.toEqual(pending);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING',
        retry_count: 2,
        last_error: 'Error temporal',
      }),
    );
    expect(statusEq).toHaveBeenCalledWith('status', 'RUNNING');
  });

  it('completa o falla solamente trabajos RUNNING', async () => {
    const completed = {
      ...jobRow('COMPLETED'),
      finished_at: '2026-08-10T02:00:00.000Z',
    };
    const completeMock = transitionSetup(completed);
    await expect(completeMock.repository.complete(JOB_ID)).resolves.toEqual(
      completed,
    );
    expect(completeMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'COMPLETED',
        retry_count: 0,
        finished_at: NOW,
      }),
    );

    const failed = {
      ...jobRow('FAILED'),
      last_error: 'Falló el batch',
      finished_at: '2026-08-10T03:00:00.000Z',
    };
    const failMock = transitionSetup(failed);
    await expect(
      failMock.repository.fail(JOB_ID, 'Falló el batch'),
    ).resolves.toEqual(failed);
    expect(failMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        last_error: 'Falló el batch',
        finished_at: NOW,
      }),
    );
    expect(failMock.statusEq).toHaveBeenCalledWith('status', 'RUNNING');
  });

  it('convierte errores de lectura y escritura en mensajes genéricos', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive database details' },
    });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const readMock = setup({ select });

    await expect(readMock.repository.findById(JOB_ID)).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo leer la sincronización de Mercado Libre',
    });

    const writeMock = transitionSetup(null, {
      message: 'sensitive database details',
    });
    await expect(writeMock.repository.complete(JOB_ID)).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo actualizar la sincronización de Mercado Libre',
    });
  });
});
