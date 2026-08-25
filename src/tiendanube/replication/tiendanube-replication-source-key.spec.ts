import { TiendanubeReplicationService } from './tiendanube-replication.service';

describe('TiendanubeReplicationService sourceKey bridge', () => {
  const connection = { user_id: 'user-a', seller_id: 42 };
  const product = { id: 'product-a', external_key: 'item:MLA1' };

  function createService() {
    const token = {
      getStoredConnection: jest.fn().mockResolvedValue(connection),
    };
    const products = {
      findByExternalKey: jest.fn().mockResolvedValue(product),
    };
    const service = new TiendanubeReplicationService(
      token as never,
      products as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { products, service };
  }

  it('resuelve una clave item dentro del seller autenticado', async () => {
    const { products, service } = createService();
    const replicate = jest
      .spyOn(service, 'replicateOrUpdateBySourceId')
      .mockResolvedValue({
        ok: true,
        action: 'updated',
        mercadolibreSourceId: 'product-a',
        tiendanubeProductId: '10',
      });

    await service.replicateBySourceKey('user-a', 'item:MLA1');

    expect(products.findByExternalKey).toHaveBeenCalledWith(42, 'item:MLA1');
    expect(replicate).toHaveBeenCalledWith('user-a', 'product-a');
  });

  it('rechaza una clave inexistente sin ejecutar la replicación', async () => {
    const { products, service } = createService();
    products.findByExternalKey.mockResolvedValue(null);

    await expect(
      service.replicateBySourceKey('user-a', 'family:123'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('delega creacion y actualizacion sin duplicar el flujo', async () => {
    const { products, service } = createService();
    const upsert = jest
      .spyOn(service, 'replicateOrUpdateBySourceId')
      .mockResolvedValueOnce({
        ok: true,
        action: 'created',
        mercadolibreSourceId: 'product-a',
        tiendanubeProductId: '101',
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'updated',
        mercadolibreSourceId: 'product-a',
        tiendanubeProductId: '101',
      });

    await expect(
      service.replicateOrUpdateBySourceKey('user-a', 'item:MLA1'),
    ).resolves.toMatchObject({ action: 'created' });
    await expect(
      service.replicateOrUpdateBySourceKey('user-a', 'item:MLA1'),
    ).resolves.toMatchObject({ action: 'updated' });

    expect(products.findByExternalKey).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('rechaza un sourceKey no soportado antes de consultar Mercado Libre', async () => {
    const { products, service } = createService();

    await expect(
      service.replicateOrUpdateBySourceKey('user-a', 'item:MLB1'),
    ).rejects.toMatchObject({ status: 400 });

    expect(products.findByExternalKey).not.toHaveBeenCalled();
  });
});
