import { SupabaseService } from '../database/supabase.service';
import { SupabaseRecentSalesRepository } from './supabase-recent-sales.repository';
import type { SaveRecentSale } from './sales.types';

describe('SupabaseRecentSalesRepository', () => {
  it('lee ventas recientes sin filtrar por user_id', async () => {
    const order = jest.fn().mockResolvedValue({ data: [], error: null });
    const gte = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ gte });
    const from = jest.fn().mockReturnValue({ select });
    const repository = new SupabaseRecentSalesRepository({
      getClient: jest.fn().mockReturnValue({ from }),
    } as unknown as SupabaseService);
    const since = new Date('2026-09-14T15:00:00.000Z');

    await expect(repository.findSince(since)).resolves.toEqual([]);

    expect(from).toHaveBeenCalledWith('recent_sales');
    expect(select).toHaveBeenCalledWith('*');
    expect(gte).toHaveBeenCalledWith('sold_at', since.toISOString());
    expect(order).toHaveBeenCalledWith('sold_at', { ascending: false });
  });

  it('lee el detalle por saleId sin validar el user_id de la venta', async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const repository = new SupabaseRecentSalesRepository({
      getClient: jest.fn().mockReturnValue({ from }),
    } as unknown as SupabaseService);

    await expect(
      repository.findById('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).resolves.toBeNull();

    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith(
      'id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  it('usa la clave natural de la linea para actualizar sin duplicar webhooks', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ upsert });
    const repository = new SupabaseRecentSalesRepository({
      getClient: jest.fn().mockReturnValue({ from }),
    } as unknown as SupabaseService);
    const sale: SaveRecentSale = {
      userId: '11111111-1111-4111-8111-111111111111',
      channel: 'MERCADOLIBRE',
      externalOrderId: 'order-1',
      externalOrderItemId: 'line-1',
      soldAt: '2026-09-14T12:00:00.000Z',
      quantity: 1,
      productName: 'Remera',
      sku: null,
      mlItemId: 'MLA1',
      mlVariationId: '2',
      userProductId: null,
      familyId: null,
      tnProductId: null,
      tnVariantId: null,
      color: null,
      size: null,
      mappingStatus: 'UNLINKED',
    };

    await repository.saveMany([sale]);

    expect(from).toHaveBeenCalledWith('recent_sales');
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: sale.userId,
          channel: sale.channel,
          external_order_id: sale.externalOrderId,
          external_order_item_id: sale.externalOrderItemId,
        }),
      ],
      {
        onConflict: 'user_id,channel,external_order_id,external_order_item_id',
      },
    );
  });
});
