import type { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import type { TiendanubeMigrationDiscoveryService } from '../../tiendanube/migration/tiendanube-migration-discovery.service';
import { TiendaNegocioCatalogService } from './tiendanegocio-catalog.service';

describe('Tienda Negocio: catálogo fuente', () => {
  const tokens = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 777 }),
    getValidAccessToken: jest.fn().mockResolvedValue('ml-token'),
  };
  const discovery = {
    discoverPage: jest.fn().mockResolvedValue({
      items: [
        {
          sourceKey: 'family:123',
          title: 'Remera mujer',
          mlaIds: ['MLA1', 'MLA2'],
          familyId: '123',
          mlauIds: ['MLAU1', 'MLAU2'],
        },
        {
          sourceKey: 'item:MLA3',
          title: 'Buzo',
          mlaIds: ['MLA3'],
          familyId: null,
          mlauIds: [],
        },
      ],
      nextScrollId: 'next-123',
      finished: false,
    }),
  };

  it('lee el seller autenticado y conserva cada publicación y familia', async () => {
    const service = new TiendaNegocioCatalogService(
      tokens as unknown as MercadolibreTokenService,
      discovery as unknown as TiendanubeMigrationDiscoveryService,
    );

    const result = await service.getPage('user-1', null);

    expect(discovery.discoverPage).toHaveBeenCalledWith({
      sellerId: 777,
      accessToken: 'ml-token',
      scrollId: null,
    });
    expect(result.products).toHaveLength(2);
    expect(result.products[0]).toMatchObject({
      sourceKey: 'family:123',
      mlaIds: ['MLA1', 'MLA2'],
      mlauIds: ['MLAU1', 'MLAU2'],
    });
    expect(result.nextCursor).toBe('next-123');
    expect(result.finished).toBe(false);
  });

  it('permite continuar con un cursor sin reiniciar el barrido', async () => {
    const service = new TiendaNegocioCatalogService(
      tokens as unknown as MercadolibreTokenService,
      discovery as unknown as TiendanubeMigrationDiscoveryService,
    );
    await service.getPage('user-1', 'next-123');
    expect(discovery.discoverPage).toHaveBeenLastCalledWith({
      sellerId: 777, accessToken: 'ml-token', scrollId: 'next-123',
    });
  });
});
