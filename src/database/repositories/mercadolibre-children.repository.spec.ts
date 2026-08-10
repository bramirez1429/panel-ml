import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../database.types';
import { SupabaseService } from '../supabase.service';
import { MercadolibreChildrenRepository } from './mercadolibre-children.repository';
import { MercadolibreChildRow } from './mercadolibre-publications.types';

/** Crea un hijo almacenado. */
function childRow(index: number): MercadolibreChildRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    product_id: '22222222-2222-4222-8222-222222222222',
    item_id: `MLA${index}`,
    user_product_id: `MLAU${index}`,
    variant_label: null,
    title: `Hijo ${index}`,
    thumbnail: null,
    status: 'active',
    currency_id: 'ARS',
    listing_type_id: null,
    price: 100,
    available_quantity: 1,
    sold_quantity: 0,
    attributes: [],
    permalink: null,
    source_updated_at: null,
    last_synced_at: '2026-08-09T00:00:00.000Z',
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
  return { repository: new MercadolibreChildrenRepository(supabase), from };
}

describe('MercadolibreChildrenRepository', () => {
  it('lee todos los hijos en páginas internas de mil', async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) =>
      childRow(index + 1),
    );
    const range = jest
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [childRow(1001)], error: null });
    const order = jest.fn().mockReturnValue({ range });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    const { repository } = setup({ select });

    const result = await repository.findByProductId(firstPage[0].product_id);

    expect(result).toHaveLength(1001);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('hace upsert en chunks y usa defaultToNull false', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const { repository, from } = setup({ upsert });
    const children = Array.from({ length: 201 }, (_, index) =>
      childRow(index + 1),
    );

    await repository.upsertMany([]);
    expect(from).not.toHaveBeenCalled();
    await repository.upsertMany(children);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, expect.any(Array), {
      onConflict: 'item_id',
      defaultToNull: false,
    });
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({ item_id: 'MLA201' })],
      { onConflict: 'item_id', defaultToNull: false },
    );
  });

  it('borra solamente los hijos ausentes', async () => {
    const inFilter = jest.fn().mockResolvedValue({ error: null });
    const eq = jest.fn().mockReturnValue({ in: inFilter });
    const deleteQuery = jest.fn().mockReturnValue({ eq });
    const { repository } = setup({ delete: deleteQuery });
    jest
      .spyOn(repository, 'findByProductId')
      .mockResolvedValue([childRow(1), childRow(2)]);

    await repository.deleteMissingChildren(childRow(1).product_id, ['MLA2']);

    expect(eq).toHaveBeenCalledWith('product_id', childRow(1).product_id);
    expect(inFilter).toHaveBeenCalledWith('item_id', ['MLA1']);
  });

  it('borra todos los hijos cuando la lista actual está vacía', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const deleteQuery = jest.fn().mockReturnValue({ eq });
    const { repository } = setup({ delete: deleteQuery });
    const deleteByProduct = jest.spyOn(repository, 'deleteByProductId');

    await repository.deleteMissingChildren(childRow(1).product_id, []);

    expect(deleteByProduct).toHaveBeenCalledWith(childRow(1).product_id);
  });

  it('borra por producto o item usando filtros explícitos', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const deleteQuery = jest.fn().mockReturnValue({ eq });
    const { repository } = setup({ delete: deleteQuery });

    await repository.deleteByProductId(childRow(1).product_id);
    await repository.deleteByItemId('MLA1');

    expect(eq).toHaveBeenNthCalledWith(1, 'product_id', childRow(1).product_id);
    expect(eq).toHaveBeenNthCalledWith(2, 'item_id', 'MLA1');
  });

  it('convierte errores Supabase en un 503 genérico', async () => {
    const eq = jest.fn().mockResolvedValue({
      error: { message: 'sensitive database details' },
    });
    const deleteQuery = jest.fn().mockReturnValue({ eq });
    const { repository } = setup({ delete: deleteQuery });

    await expect(repository.deleteByItemId('MLA1')).rejects.toMatchObject({
      status: 503,
    });
  });
});
