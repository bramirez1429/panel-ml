import { TiendanubeBulkEditController } from './tiendanube-bulk-edit.controller';

describe('TiendanubeBulkEditController', () => {
  it('devuelve null cuando la tienda autenticada no tiene trabajo activo', async () => {
    const service = { activeJob: jest.fn().mockResolvedValue(null) };
    const controller = new TiendanubeBulkEditController(service as never);
    await expect(controller.active({ id: 'user-1' } as never)).resolves.toBeNull();
    expect(service.activeJob).toHaveBeenCalledWith('user-1');
  });

  it('devuelve sólo el progreso entregado por el servicio autenticado', async () => {
    const active = { id: 'job-1', status: 'RUNNING', totalVariants: 30, completedVariants: 10, failedVariants: 1, pendingVariants: 19 };
    const service = { activeJob: jest.fn().mockResolvedValue(active) };
    const controller = new TiendanubeBulkEditController(service as never);
    await expect(controller.active({ id: 'user-1' } as never)).resolves.toEqual(active);
  });
});
