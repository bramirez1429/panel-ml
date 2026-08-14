import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../database.types';
import { SupabaseService } from '../supabase.service';
import { MercadolibreProductsRepository } from './mercadolibre-products.repository';
import { MercadolibreProductRow } from './mercadolibre-publications.types';

const SYNC_ID = '11111111-1111-4111-8111-111111111111';

/** Crea un producto completo almacenado. */
function productRow(): MercadolibreProductRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    seller_id: 123,
    external_key: 'item:MLA1',
    model: 'SHARED',
    family_id: null,
    parent_item_id: 'MLA1',
    family_name: null,
    title: 'Producto',
    thumbnail: null,
    status: 'active',
    category_id: 'MLA1',
    currency_id: 'ARS',
    price_from: 100,
    price_to: 100,
    stock_total: 3,
    children_count: 0,
    permalink: null,
    shared_variations: [],
    pictures: [],
    shared_skus: {},
    management_synced_at: null,
    source_updated_at: null,
    last_synced_at: '2026-08-09T00:00:00.000Z',
    last_full_sync_id: SYNC_ID,
    created_at: '2026-08-09T00:00:00.000Z',
    updated_at: '2026-08-09T00:00:00.000Z',
  };
}

/** Crea el repository con una tabla Supabase simulada. */
function setup(table: object) {
  const from = jest.fn().mockReturnValue(table);
  const client = { from } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;
  return { repository: new MercadolibreProductsRepository(supabase), from };
}

describe('MercadolibreProductsRepository', () => {
  it('pagina por vendedor con count exacto y rango inclusivo', async () => {
    const row = productRow();
    const range = jest.fn().mockResolvedValue({
      data: [{ ...row, last_full_sync_id: undefined }],
      error: null,
      count: 21,
    });
    const secondOrder = jest.fn().mockReturnValue({ range });
    const firstOrder = jest.fn().mockReturnValue({ order: secondOrder });
    const eq = jest.fn().mockReturnValue({ order: firstOrder });
    const select = jest.fn().mockReturnValue({ eq });
    const { repository } = setup({ select });

    const result = await repository.findPage(123, 2, 20);

    expect(result.total).toBe(21);
    expect(eq).toHaveBeenCalledWith('seller_id', 123);
    expect(range).toHaveBeenCalledWith(20, 39);
    expect(select).toHaveBeenCalledWith(expect.stringContaining('seller_id'), {
      count: 'exact',
    });
    expect(select).toHaveBeenCalledWith(
      expect.not.stringContaining('last_full_sync_id'),
      expect.anything(),
    );
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining('shared_variations'),
      expect.anything(),
    );
  });

  it('busca por UUID y clave externa sin exponer el marcador interno', async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const secondEq = jest.fn().mockReturnValue({ maybeSingle });
    const firstEq = jest.fn().mockReturnValue({ eq: secondEq });
    const select = jest.fn().mockReturnValue({ eq: firstEq });
    const { repository } = setup({ select });

    await repository.findById(123, productRow().id);
    await repository.findByExternalKey(123, 'item:MLA1');

    expect(firstEq).toHaveBeenCalledWith('seller_id', 123);
    expect(secondEq).toHaveBeenNthCalledWith(1, 'id', productRow().id);
    expect(secondEq).toHaveBeenNthCalledWith(2, 'external_key', 'item:MLA1');
    expect(select).toHaveBeenCalledWith(
      expect.not.stringContaining('last_full_sync_id'),
    );
  });

  it('hace upsert por vendedor y clave sin convertir omisiones en null', async () => {
    const row = productRow();
    const single = jest.fn().mockResolvedValue({ data: row, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const upsert = jest.fn().mockReturnValue({ select });
    const { repository } = setup({ upsert });

    await expect(repository.upsert(row)).resolves.toEqual(row);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ external_key: 'item:MLA1' }),
      {
        onConflict: 'seller_id,external_key',
        defaultToNull: false,
      },
    );
  });

  it('marca una sincronización completa y omite listas vacías', async () => {
    const inFilter = jest.fn().mockResolvedValue({ error: null });
    const eq = jest.fn().mockReturnValue({ in: inFilter });
    const update = jest.fn().mockReturnValue({ eq });
    const { repository, from } = setup({ update });

    await repository.markFullSync(123, [], SYNC_ID);
    expect(from).not.toHaveBeenCalled();

    await repository.markFullSync(123, ['item:MLA1'], SYNC_ID);
    expect(eq).toHaveBeenCalledWith('seller_id', 123);
    expect(inFilter).toHaveBeenCalledWith('external_key', ['item:MLA1']);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ last_full_sync_id: SYNC_ID }),
    );
  });

  it('borra no vistos incluyendo marcadores null y siempre filtra seller', async () => {
    const startedAt = '2026-08-09T12:00:00.000Z';
    const or = jest.fn().mockResolvedValue({ error: null });
    const lt = jest.fn().mockReturnValue({ or });
    const eq = jest.fn().mockReturnValue({ lt });
    const deleteQuery = jest.fn().mockReturnValue({ eq });
    const { repository } = setup({ delete: deleteQuery });

    await repository.deleteNotSeenInFullSync(123, SYNC_ID, startedAt);

    expect(eq).toHaveBeenCalledWith('seller_id', 123);
    expect(lt).toHaveBeenCalledWith('last_synced_at', startedAt);
    expect(or).toHaveBeenCalledWith(
      `last_full_sync_id.is.null,last_full_sync_id.neq.${SYNC_ID}`,
    );
  });

  it('borra claves explícitas y propaga errores como 503 genérico', async () => {
    const inFilter = jest.fn().mockResolvedValue({
      error: { message: 'sensitive database details' },
    });
    const eq = jest.fn().mockReturnValue({ in: inFilter });
    const deleteQuery = jest.fn().mockReturnValue({ eq });
    const { repository } = setup({ delete: deleteQuery });

    await expect(
      repository.deleteByExternalKeys(123, ['item:MLA1']),
    ).rejects.toMatchObject({ status: 503 });
    expect(eq).toHaveBeenCalledWith('seller_id', 123);
  });
});
