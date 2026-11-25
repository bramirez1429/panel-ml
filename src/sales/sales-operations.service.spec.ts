import type { RecentSaleRow } from '../database/database.types';
import { argentinaDay, groupOrders, SalesOperationsController } from './sales-operations.service';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';

function row(overrides: Partial<RecentSaleRow> = {}): RecentSaleRow {
  return {
    id:'line-a', user_id:'owner-a', channel:'MERCADOLIBRE',
    external_order_id:'123', external_order_item_id:'100',
    sold_at:'2026-11-24T14:00:00.000Z', quantity:2, product_name:'Remera',
    sku:'REM-M', ml_item_id:'MLA123', ml_variation_id:'20', user_product_id:null,
    family_id:null, tn_product_id:null, tn_variant_id:null, color:'Negro', size:'M',
    mapping_status:'UNLINKED', order_status:'paid', unit_price:1000, currency:'ARS',
    created_at:'2026-11-24T14:00:00.000Z', updated_at:'2026-11-24T14:00:00.000Z',
    ...overrides,
  };
}

describe('gestión operativa de ventas', () => {
  it('agrupa las líneas de un pedido, no las cuenta como ventas distintas', () => {
    const result = groupOrders([
      row(), row({ id:'line-b', external_order_item_id:'101', quantity:1, sku:'REM-L' }),
      row({ id:'line-c', channel:'TIENDANUBE' }),
    ], [], []);
    expect(result).toHaveLength(2);
    expect(result.find((order)=>order.channel==='MERCADOLIBRE')).toMatchObject({
      quantity:3, amount:3000, unread:true, status:'PENDING',
    });
  });

  it('distingue una notificación leída de una preparación completada', () => {
    const read = [{ channel:'MERCADOLIBRE' as const, external_order_id:'123' }];
    expect(groupOrders([row()], [], read)[0]).toMatchObject({ unread:false, status:'PENDING' });
    const workflow = [{ ...read[0], completed_at:'2026-11-24T15:00:00Z', completed_by:'user-a' }];
    expect(groupOrders([row()], workflow, [])[0]).toMatchObject({
      unread:true, status:'COMPLETED', completedBy:'user-a',
    });
    expect(groupOrders([row({ order_status:'cancelled' })], workflow, [])[0]).toMatchObject({
      status:'CANCELLED', unread:false, completedAt:null,
    });
  });

  it('no inventa el importe si una línea no tiene precio', () => {
    expect(groupOrders([row({ unit_price:null })], [], [])[0]?.amount).toBeNull();
  });

  it('calcula el día calendario en Buenos Aires y protege los endpoints', () => {
    expect(argentinaDay(new Date('2026-11-24T02:59:59.000Z'))).toBe('2026-11-23');
    expect(argentinaDay(new Date('2026-11-24T03:00:00.000Z'))).toBe('2026-11-24');
    expect(Reflect.getMetadata(GUARDS_METADATA,SalesOperationsController)).toContain(AccessTokenGuard);
  });
});
