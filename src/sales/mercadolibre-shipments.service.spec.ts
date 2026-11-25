import { groupLiveOrders, shipmentLogistic, shipmentStage } from './mercadolibre-shipments.service';

describe('gestión de envíos', () => {
  const today = '2026-11-25';
  it('clasifica por el vencimiento SLA en Argentina, no por la venta', () => {
    expect(shipmentStage('ready_to_ship', 'self_service', '2026-11-26T00:00:00Z', today)).toBe('TODAY');
    expect(shipmentStage('handling', 'drop_off', '2026-11-26T03:00:00Z', today)).toBe('UPCOMING');
    expect(shipmentStage('ready_to_ship', 'drop_off', '2026-11-25T02:59:59Z', today)).toBe('OVERDUE');
  });
  it('no inventa un vencimiento y respeta el estado oficial', () => {
    expect(shipmentStage('ready_to_ship', 'self_service', null, today)).toBe('REVIEW');
    expect(shipmentStage('shipped', 'self_service', null, today)).toBe('TRANSIT');
    expect(shipmentStage('delivered', 'drop_off', null, today)).toBe('FINISHED');
    expect(shipmentStage('handling', 'fulfillment', null, today)).toBe('MANAGED');
  });
  it('agrupa dos órdenes en un solo paquete, sin duplicar registros', () => {
    const first = { orderId: '1', shipmentId: '100', soldAt: '2026-11-24T23:00:00Z', lines: [], completedAt: null };
    const second = { ...first, orderId: '2' };
    expect(groupLiveOrders([first, second, first])).toHaveLength(1);
    expect(groupLiveOrders([first, second, first])[0].orders).toHaveLength(2);
    expect(groupLiveOrders([first, {...second, shipmentId: null}])).toHaveLength(2);
  });
  it('reconoce tanto la respuesta actual como la heredada', () => {
    expect(shipmentLogistic({ logistic: { type: 'self_service' } })).toBe('self_service');
    expect(shipmentLogistic({ logistic_type: 'drop_off' })).toBe('drop_off');
  });
});
