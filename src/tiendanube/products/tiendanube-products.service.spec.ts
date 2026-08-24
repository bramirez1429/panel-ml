import { BadGatewayException } from '@nestjs/common';

import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeProductsService } from './tiendanube-products.service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ACCESS_TOKEN_A = 'private-tiendanube-access-token-a';

type ConnectionRepositoryMock = jest.Mocked<
  Pick<TiendanubeConnectionRepository, 'findCredentialsByUserId'>
>;
type ApiServiceMock = jest.Mocked<Pick<TiendanubeApiService, 'get'>>;

describe('TiendanubeProductsService', () => {
  let service: TiendanubeProductsService;
  let connectionRepository: ConnectionRepositoryMock;
  let apiService: ApiServiceMock;

  beforeEach(() => {
    connectionRepository = {
      findCredentialsByUserId: jest.fn(),
    };
    apiService = {
      get: jest.fn().mockRejectedValue(new Error('Unexpected API call')),
    };
    service = new TiendanubeProductsService(
      connectionRepository as unknown as TiendanubeConnectionRepository,
      apiService as unknown as TiendanubeApiService,
    );
  });

  it('consulta los productos con la conexión interna del usuario', async () => {
    connectionRepository.findCredentialsByUserId.mockResolvedValue({
      storeId: '987654',
      accessToken: ACCESS_TOKEN_A,
      scope: 'read_products',
    });
    apiService.get.mockResolvedValue([
      {
        id: 1234,
        name: { es: 'Remera', pt: 'Camiseta' },
        published: true,
        variants: [{ id: 101, access_token: 'must-not-leak' }],
        images: [
          {
            id: 201,
            src: 'https://example.com/remera.jpg',
            position: 1,
            client_secret: 'must-not-leak',
          },
        ],
        access_token: 'must-not-leak',
      },
    ]);

    const result = await service.listByUserId(USER_A);

    expect(connectionRepository.findCredentialsByUserId).toHaveBeenCalledTimes(
      1,
    );
    expect(connectionRepository.findCredentialsByUserId).toHaveBeenCalledWith(
      USER_A,
    );
    expect(apiService.get).toHaveBeenCalledTimes(1);
    expect(apiService.get).toHaveBeenCalledWith(
      '987654',
      '/products',
      ACCESS_TOKEN_A,
    );
    expect(result).toEqual([
      {
        id: 1234,
        name: { es: 'Remera', pt: 'Camiseta' },
        published: true,
        variants: [{ id: 101 }],
        images: [
          {
            id: 201,
            src: 'https://example.com/remera.jpg',
            position: 1,
          },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /access[_-]?token|authorization|client[_-]?secret|must-not-leak/i,
    );
  });

  it('sin conexión devuelve un error controlado y no llama a Tiendanube', async () => {
    connectionRepository.findCredentialsByUserId.mockResolvedValue(null);

    await expect(service.listByUserId(USER_B)).rejects.toMatchObject({
      status: 401,
      message: 'Primero conectá Tiendanube desde /tiendanube/connect',
    });
    expect(connectionRepository.findCredentialsByUserId).toHaveBeenCalledWith(
      USER_B,
    );
    expect(apiService.get).not.toHaveBeenCalled();
  });

  it('no llama a Tiendanube si la conexión almacenada no tiene token', async () => {
    connectionRepository.findCredentialsByUserId.mockResolvedValue({
      storeId: '987654',
      accessToken: '   ',
      scope: 'read_products',
    });

    await expect(service.listByUserId(USER_A)).rejects.toMatchObject({
      status: 401,
    });
    expect(apiService.get).not.toHaveBeenCalled();
  });

  it('propaga de forma controlada los errores seguros de Tiendanube', async () => {
    connectionRepository.findCredentialsByUserId.mockResolvedValue({
      storeId: '987654',
      accessToken: ACCESS_TOKEN_A,
      scope: 'read_products',
    });
    apiService.get.mockRejectedValue(
      new BadGatewayException('No se pudo conectar con Tiendanube'),
    );

    let caught: unknown;
    try {
      await service.listByUserId(USER_A);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      status: 502,
      message: 'No se pudo conectar con Tiendanube',
    });
    expect(JSON.stringify(caught)).not.toContain(ACCESS_TOKEN_A);
  });
});
