import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeCategoriesService } from './tiendanube-categories.service';

const AUTHENTICATED_USER_ID = 'user-b';

type ConnectionRepositoryMock = jest.Mocked<
  Pick<TiendanubeConnectionRepository, 'findOwnedCredentialsByUserId'>
>;
type ApiServiceMock = jest.Mocked<Pick<TiendanubeApiService, 'get'>>;

describe('TiendanubeCategoriesService', () => {
  it('carga categorías con la conexión compartida y conserva su respuesta pública', async () => {
    const connections: ConnectionRepositoryMock = {
      findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({
        userId: 'user-a',
        storeId: '123456',
        accessToken: 'tn-token',
        scope: 'write_products',
      }),
    };
    const api: ApiServiceMock = {
      get: jest.fn().mockResolvedValue([
        {
          id: 10,
          name: { es: 'Remeras' },
          parent_id: null,
        },
        {
          id: 20,
          name: { es: 'Buzos' },
          parent_id: null,
        },
      ]),
    };
    const service = new TiendanubeCategoriesService(
      connections as unknown as TiendanubeConnectionRepository,
      api as unknown as TiendanubeApiService,
    );

    await expect(service.listByUserId(AUTHENTICATED_USER_ID)).resolves.toEqual([
      { id: 10, name: 'Remeras', parentId: null },
      { id: 20, name: 'Buzos', parentId: null },
    ]);
    expect(connections.findOwnedCredentialsByUserId).toHaveBeenCalledWith(
      AUTHENTICATED_USER_ID,
    );
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith(
      '123456',
      '/categories?page=1&per_page=200',
      'tn-token',
    );
  });
});
