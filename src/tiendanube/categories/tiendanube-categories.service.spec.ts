import type { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import type { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeCategoriesService } from './tiendanube-categories.service';

describe('TiendanubeCategoriesService workspace', () => {
  it('usa la misma conexión comercial para usuarios del workspace SAEL', async () => {
    const connections = {
      findCredentialsByUserId: jest.fn().mockResolvedValue({
        storeId: '123456',
        accessToken: 'tn-token',
        scope: 'write_products',
      }),
    };
    const api = {
      get: jest.fn().mockResolvedValue([
        { id: 10, name: { es: 'Remeras' }, parent_id: null },
      ]),
    };
    const service = new TiendanubeCategoriesService(
      connections as unknown as TiendanubeConnectionRepository,
      api as unknown as TiendanubeApiService,
    );

    await expect(service.listByUserId('prueba')).resolves.toEqual([
      { id: 10, name: 'Remeras', parentId: null },
    ]);
    await expect(service.listByUserId('b.ramireeez')).resolves.toEqual([
      { id: 10, name: 'Remeras', parentId: null },
    ]);
    expect(connections.findCredentialsByUserId).toHaveBeenCalledWith('prueba');
    expect(connections.findCredentialsByUserId).toHaveBeenCalledWith(
      'b.ramireeez',
    );
    expect(api.get).toHaveBeenNthCalledWith(
      1,
      '123456',
      '/categories?page=1&per_page=200',
      'tn-token',
    );
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      '123456',
      '/categories?page=1&per_page=200',
      'tn-token',
    );
  });
});
