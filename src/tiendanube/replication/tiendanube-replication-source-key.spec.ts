import { TiendanubeReplicationService } from './tiendanube-replication.service';

describe('TiendanubeReplicationService sourceKey bridge', () => {
  function createService() {
    const products = { findByExternalKey: jest.fn() };
    const directReplication = {
      replicate: jest.fn().mockResolvedValue({
        ok: true,
        action: 'updated',
        sourceKey: 'item:MLA1',
        tiendanubeProductId: '10',
      }),
    };
    const service = new TiendanubeReplicationService(
      {} as never,
      products as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      directReplication as never,
    );
    return { directReplication, products, service };
  }

  it('delega sourceKey al flujo directo sin leer publicaciones de Supabase', async () => {
    const { directReplication, products, service } = createService();

    await expect(
      service.replicateOrUpdateBySourceKey('user-a', 'family:123', {
        priceMode: 'KEEP_SOURCE',
        categoryId: 9,
      }),
    ).resolves.toMatchObject({ action: 'updated' });
    expect(directReplication.replicate).toHaveBeenCalledWith(
      'user-a',
      'family:123',
      { priceMode: 'KEEP_SOURCE', categoryId: 9 },
    );
    expect(products.findByExternalKey).not.toHaveBeenCalled();
  });

  it('rechaza un sourceKey no soportado antes de consultar servicios', async () => {
    const { directReplication, products, service } = createService();

    await expect(
      service.replicateOrUpdateBySourceKey('user-a', 'item:MLB1'),
    ).rejects.toMatchObject({ status: 400 });
    expect(directReplication.replicate).not.toHaveBeenCalled();
    expect(products.findByExternalKey).not.toHaveBeenCalled();
  });
});
