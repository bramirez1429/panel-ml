import { BadGatewayException } from '@nestjs/common';

import { VariantChannelLinksRepository } from '../../sales/variant-channel-links.repository';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeProductsService } from './tiendanube-products.service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ACCESS_TOKEN_A = 'private-tiendanube-access-token-a';

type ConnectionRepositoryMock = jest.Mocked<
  Pick<TiendanubeConnectionRepository, 'findCredentialsByUserId'>
>;
type ApiServiceMock = jest.Mocked<
  Pick<TiendanubeApiService, 'get' | 'getWithMeta'>
>;
<<<<<<< HEAD
type VariantLinksRepositoryMock = jest.Mocked<
  Pick<VariantChannelLinksRepository, 'findByUserIdAndMlItemId'>
>;
=======
>>>>>>> origin/feat/sincronizacion-publicaciones

describe('TiendanubeProductsService', () => {
  let service: TiendanubeProductsService;
  let connectionRepository: ConnectionRepositoryMock;
  let apiService: ApiServiceMock;
  let variantLinks: VariantLinksRepositoryMock;

  beforeEach(() => {
    connectionRepository = {
      findCredentialsByUserId: jest.fn(),
    };
    apiService = {
      get: jest.fn().mockRejectedValue(new Error('Unexpected API call')),
      getWithMeta: jest.fn().mockRejectedValue(new Error('Unexpected API call')),
<<<<<<< HEAD
    };
    variantLinks = {
      findByUserIdAndMlItemId: jest.fn(),
=======
>>>>>>> origin/feat/sincronizacion-publicaciones
    };
    service = new TiendanubeProductsService(
      connectionRepository as unknown as TiendanubeConnectionRepository,
      apiService as unknown as TiendanubeApiService,
      variantLinks as unknown as VariantChannelLinksRepository,
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

<<<<<<< HEAD
  it('lee la variante de Tiendanube vinculada sin buscar productos por nombre', async () => {
    variantLinks.findByUserIdAndMlItemId.mockResolvedValue([
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: USER_A,
        mlItemId: 'MLA1491447379',
        mlVariationId: '123456789',
        userProductId: 'MLAU123',
        familyId: '7452953254396627',
        tnProductId: '1001',
        tnVariantId: '1101',
        sku: 'SAVED-SKU',
        normalizedColor: null,
        normalizedSize: null,
        matchSource: 'MANUAL',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    connectionRepository.findCredentialsByUserId.mockResolvedValue({
      storeId: '987654',
      accessToken: ACCESS_TOKEN_A,
      scope: 'read_products',
    });
    apiService.get.mockResolvedValue({
      id: 1101,
      price: '25000.50',
      promotional_price: '19999',
      stock: 7,
      sku: 'TN-SKU-1101',
    });

    await expect(
      service.getByMercadolibreItem(USER_A, 'MLA1491447379', '123456789'),
    ).resolves.toEqual({
      linked: true,
      price: 25000.5,
      promotionalPrice: 19999,
      stock: 7,
      sku: 'TN-SKU-1101',
    });

    expect(variantLinks.findByUserIdAndMlItemId).toHaveBeenCalledWith(
      USER_A,
      'MLA1491447379',
      '123456789',
    );
    expect(apiService.get).toHaveBeenCalledWith(
      '987654',
      '/products/1001/variants/1101',
      ACCESS_TOKEN_A,
    );
  });

  it('informa que no hay vínculo sin consultar Tiendanube', async () => {
    variantLinks.findByUserIdAndMlItemId.mockResolvedValue([]);

    await expect(
      service.getByMercadolibreItem(USER_A, 'MLA1491447379'),
    ).resolves.toEqual({
      linked: false,
      price: null,
      promotionalPrice: null,
      stock: null,
      sku: null,
    });

    expect(connectionRepository.findCredentialsByUserId).not.toHaveBeenCalled();
    expect(apiService.get).not.toHaveBeenCalled();
  });

  it('consulta el catálogo paginado de la tienda del usuario', async () => {
=======
  it('consulta una pagina completa del catalogo y proyecta variantes', async () => {
>>>>>>> origin/feat/sincronizacion-publicaciones
    connectionRepository.findCredentialsByUserId.mockResolvedValue({
      storeId: '987654',
      accessToken: ACCESS_TOKEN_A,
      scope: 'read_products',
    });
    apiService.getWithMeta.mockResolvedValue({
      data: [
        {
          id: 1234,
          name: { es: 'Remera' },
          published: true,
          visibility: 'visible',
<<<<<<< HEAD
          tags: 'verano,remera',
          attributes: [{ es: 'Color' }],
          images: [{ src: 'https://example.com/main.jpg', position: 1 }],
          variants: [
            {
              id: 101,
              values: [{ es: 'Rojo' }],
              sku: 'SKU-101',
=======
          tags: ' verano, remera ',
          attributes: [{ es: 'Color' }, { es: 'Talle' }],
          images: [
            { src: 'https://example.com/secondary.jpg', position: 2 },
            { src: 'https://example.com/main.jpg', position: 1 },
          ],
          variants: [
            {
              id: 101,
              values: [{ es: 'Rojo' }, { es: 'M' }],
              sku: 'SKU-101',
              stock_management: true,
              stock: 7,
              price: '25000.50',
              promotional_price: '19999',
            },
            {
              id: 102,
              values: [{ es: 'Azul' }, { es: 'L' }],
              sku: null,
>>>>>>> origin/feat/sincronizacion-publicaciones
              stock_management: false,
              stock: null,
              price: '25000.50',
              promotional_price: null,
            },
          ],
        },
      ],
<<<<<<< HEAD
      headers: new Headers({ 'x-total-count': '21' }),
=======
      headers: new Headers({ 'x-total-count': '41' }),
>>>>>>> origin/feat/sincronizacion-publicaciones
    });

    await expect(
      service.listCatalogByUserId(USER_A, {
<<<<<<< HEAD
        page: 1,
        limit: 20,
        q: ' remera ',
      }),
    ).resolves.toMatchObject({
      page: 1,
      hasMore: true,
      total: 21,
      products: [
        {
          id: 1234,
          mainImage: 'https://example.com/main.jpg',
          tags: ['verano', 'remera'],
          variants: [
            {
              id: 101,
              sku: 'SKU-101',
=======
        page: 2,
        limit: 20,
        q: ' remera azul ',
      }),
    ).resolves.toEqual({
      products: [
        {
          id: 1234,
          name: { es: 'Remera' },
          mainImage: 'https://example.com/main.jpg',
          tags: ['verano', 'remera'],
          published: true,
          visibility: 'visible',
          variants: [
            {
              id: 101,
              attributes: [
                { name: { es: 'Color' }, value: { es: 'Rojo' } },
                { name: { es: 'Talle' }, value: { es: 'M' } },
              ],
              sku: 'SKU-101',
              stock: 7,
              stockManagement: true,
              price: 25000.5,
              promotionalPrice: 19999,
            },
            {
              id: 102,
              attributes: [
                { name: { es: 'Color' }, value: { es: 'Azul' } },
                { name: { es: 'Talle' }, value: { es: 'L' } },
              ],
              sku: null,
>>>>>>> origin/feat/sincronizacion-publicaciones
              stock: null,
              stockManagement: false,
              price: 25000.5,
              promotionalPrice: null,
            },
          ],
        },
      ],
<<<<<<< HEAD
    });
    expect(apiService.getWithMeta).toHaveBeenCalledWith(
      '987654',
      '/products?page=1&per_page=20&q=remera',
      ACCESS_TOKEN_A,
    );
=======
      page: 2,
      hasMore: true,
      total: 41,
    });

    expect(apiService.getWithMeta).toHaveBeenCalledWith(
      '987654',
      '/products?page=2&per_page=20&q=remera+azul',
      ACCESS_TOKEN_A,
    );
    expect(apiService.get).not.toHaveBeenCalled();
>>>>>>> origin/feat/sincronizacion-publicaciones
  });
});
