import { SupabaseService } from '../database/supabase.service';
import { SupabaseRecentSalesRepository } from './supabase-recent-sales.repository';
import type { SaveRecentSale } from './sales.types';

describe('SupabaseRecentSalesRepository', () => {
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
