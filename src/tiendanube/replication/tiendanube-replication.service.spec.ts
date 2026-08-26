import {
  BadGatewayException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import type { MercadolibreProductDetail } from '../../database/repositories/mercadolibre-publications.types';
import { MercadolibreProductsRepository } from '../../database/repositories/mercadolibre-products.repository';
import type { MercadoLibreConnection } from '../../database/supabase.service';
import { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { MercadoLibreReplicationSourceService } from './mercadolibre-replication-source.service';
import {
  type CompleteTiendanubeProductLinkInput,
  type FailTiendanubeProductLinkInput,
  type Reservation,
  type ReserveTiendanubeProductLinkInput,
} from './tiendanube-product-link.repository';
import { TiendanubeReplicationService } from './tiendanube-replication.service';
import type {
  ReplicableProduct,
  TiendanubeCreateProductDto,
} from './tiendanube-replication.types';

const USER_A = '11111111-1111-4111-8111-111111111111';
const ML_PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ML_ACCESS_TOKEN = 'private-mercadolibre-token';
const TIENDANUBE_ACCESS_TOKEN = 'private-tiendanube-token';
const LINK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RESERVATION_VERSION = '2030-01-01T00:00:00.000Z';

const ML_CONNECTION: MercadoLibreConnection = {
  user_id: USER_A,
  seller_id: 123456,
  nickname: 'seller-a',
  access_token: ML_ACCESS_TOKEN,
  refresh_token: 'private-refresh-token',
  expires_at: '2030-01-01T00:00:00.000Z',
  updated_at: '2029-01-01T00:00:00.000Z',
};

const ML_PRODUCT: MercadolibreProductDetail = {
  id: ML_PRODUCT_ID,
  seller_id: ML_CONNECTION.seller_id,
  external_key: 'item:MLA123456789',
  model: 'SHARED',
  family_id: null,
  parent_item_id: 'MLA123456789',
  family_name: null,
  title: 'Remera',
  thumbnail: null,
  status: 'active',
  category_id: 'MLA109042',
  currency_id: 'ARS',
  price_from: 35_000,
  price_to: 35_000,
  stock_total: 7,
  children_count: 0,
  permalink: null,
  shared_variations: [],
  source_updated_at: null,
  last_synced_at: '2029-01-01T00:00:00.000Z',
  created_at: '2029-01-01T00:00:00.000Z',
  updated_at: '2029-01-01T00:00:00.000Z',
};

const SHARED_SOURCE: ReplicableProduct = {
  title: 'Remera clásica',
  description:
    'Primera & <b>"doble" y \'simple\'</b>\r\nSegunda con <br> literal',
  images: Array.from(
    { length: 11 },
    (_, index) => `https://example.com/image-${index + 1}.jpg`,
  ),
  attributes: [
    { id: 'COLOR', name: 'Color' },
    { id: 'SIZE', name: 'Talle' },
  ],
  variants: [
    {
      price: 35_000,
      stock: 4,
      sku: 'REM-NEG-S',
      values: [
        { attributeId: 'COLOR', value: 'Negro' },
        { attributeId: 'SIZE', value: 'S' },
      ],
    },
    {
      price: 35_000,
      stock: 3,
      sku: null,
      values: [
        { attributeId: 'COLOR', value: 'Negro' },
        { attributeId: 'SIZE', value: 'M' },
      ],
    },
  ],
};

type TokenServiceMock = jest.Mocked<
  Pick<MercadolibreTokenService, 'getStoredConnection' | 'getValidAccessToken'>
>;
type ProductRepositoryMock = jest.Mocked<
  Pick<MercadolibreProductsRepository, 'findById'>
>;
type ConnectionRepositoryMock = jest.Mocked<
  Pick<TiendanubeConnectionRepository, 'findCredentialsByUserId'>
>;
type LinkRepositoryMock = {
  reserve: jest.MockedFunction<
    (input: ReserveTiendanubeProductLinkInput) => Promise<Reservation>
  >;
  complete: jest.MockedFunction<
    (input: CompleteTiendanubeProductLinkInput) => Promise<void>
  >;
  fail: jest.MockedFunction<
    (input: FailTiendanubeProductLinkInput) => Promise<void>
  >;
};
type SourceServiceMock = jest.Mocked<
  Pick<MercadoLibreReplicationSourceService, 'load'>
>;
type ApiServiceMock = jest.Mocked<Pick<TiendanubeApiService, 'post' | 'put'>>;

describe('TiendanubeReplicationService', () => {
  let service: TiendanubeReplicationService;
  let tokenService: TokenServiceMock;
  let productRepository: ProductRepositoryMock;
  let connectionRepository: ConnectionRepositoryMock;
  let linkRepository: LinkRepositoryMock;
  let sourceService: SourceServiceMock;
  let apiService: ApiServiceMock;

  beforeEach(() => {
    tokenService = {
      getStoredConnection: jest.fn().mockResolvedValue(ML_CONNECTION),
      getValidAccessToken: jest.fn().mockResolvedValue(ML_ACCESS_TOKEN),
    };
    productRepository = {
      findById: jest.fn().mockResolvedValue(ML_PRODUCT),
    };
    connectionRepository = {
      findCredentialsByUserId: jest.fn().mockResolvedValue({
        storeId: '987654',
        accessToken: TIENDANUBE_ACCESS_TOKEN,
        scope: 'read_products write_products',
      }),
    };
    linkRepository = {
      reserve: jest.fn().mockResolvedValue({
        outcome: 'RESERVED',
        linkId: LINK_ID,
        reservationVersion: RESERVATION_VERSION,
      }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    sourceService = {
      load: jest.fn().mockResolvedValue(SHARED_SOURCE),
    };
    apiService = {
      post: jest.fn().mockResolvedValue({ id: 7654321 }),
      put: jest.fn().mockResolvedValue(undefined),
    };

    service = new TiendanubeReplicationService(
      tokenService as unknown as MercadolibreTokenService,
      productRepository as unknown as MercadolibreProductsRepository,
      connectionRepository as unknown as TiendanubeConnectionRepository,
      linkRepository,
      sourceService as unknown as MercadoLibreReplicationSourceService,
      apiService as unknown as TiendanubeApiService,
    );
  });

  it('crea un solo producto SHARED oculto y completa el vínculo', async () => {
    const result = await service.replicate(USER_A, ML_PRODUCT_ID);

    expect(productRepository.findById).toHaveBeenCalledWith(
      ML_CONNECTION.seller_id,
      ML_PRODUCT_ID,
    );
    expect(sourceService.load).toHaveBeenCalledWith(
      ML_PRODUCT,
      ML_CONNECTION.seller_id,
      ML_ACCESS_TOKEN,
    );
    expect(apiService.post).toHaveBeenCalledTimes(1);
    expect(apiService.post).toHaveBeenCalledWith(
      '987654',
      '/products',
      {
        name: { es: 'Remera clásica' },
        description: {
          es: 'Primera &amp; &lt;b&gt;&quot;doble&quot; y &#39;simple&#39;&lt;/b&gt;<br>Segunda con &lt;br&gt; literal',
        },
        visibility: 'visible',
        brand: 'SAEL',
        seo_title: SHARED_SOURCE.title,
        seo_description: SHARED_SOURCE.description,
        images: Array.from({ length: 9 }, (_, index) => ({
          src: `https://example.com/image-${index + 1}.jpg`,
        })),
        attributes: [{ es: 'Color' }, { es: 'Talle' }],
        variants: [
          {
            price: '35000.00',
            stock_management: true,
            stock: 4,
            sku: 'REM-NEG-S',
            values: [{ es: 'Negro' }, { es: 'S' }],
          },
          {
            price: '35000.00',
            stock_management: true,
            stock: 3,
            values: [{ es: 'Negro' }, { es: 'M' }],
          },
        ],
      },
      TIENDANUBE_ACCESS_TOKEN,
    );
    const sentPayload = apiService.post.mock.calls[0]?.[2];
    expect(sentPayload).not.toHaveProperty('published');
    expect(linkRepository.complete).toHaveBeenCalledWith({
      linkId: LINK_ID,
      userId: USER_A,
      storeId: '987654',
      mlProductId: ML_PRODUCT_ID,
      mlSourceKey: ML_PRODUCT.external_key,
      reservationVersion: RESERVATION_VERSION,
      tiendanubeProductId: '7654321',
    });
    expect(linkRepository.fail).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      alreadyReplicated: false,
      mlProductId: ML_PRODUCT_ID,
      tiendanubeProductId: '7654321',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /access[_-]?token|authorization|client[_-]?secret|private-/i,
    );
  });

  it('crea una familia VARIANT_PRICING como un único producto con variantes', async () => {
    const familyProduct = {
      ...ML_PRODUCT,
      external_key: 'family:998877',
      model: 'VARIANT_PRICING' as const,
      family_id: '998877',
      parent_item_id: null,
      children_count: 5,
    };
    const familySource: ReplicableProduct = {
      title: 'Remera familiar',
      description: null,
      images: ['https://example.com/family.jpg'],
      attributes: [
        { id: 'COLOR', name: 'Color' },
        { id: 'SIZE', name: 'Talle' },
      ],
      variants: ['38', '40', '42', '44', '46'].map((size, index) => ({
        price: 40_000 + index,
        stock: index,
        sku: index === 0 ? 'FAMILY-38' : null,
        values: [
          { attributeId: 'COLOR', value: index < 3 ? 'Negro' : 'Blanco' },
          { attributeId: 'SIZE', value: size },
        ],
      })),
    };
    productRepository.findById.mockResolvedValue(familyProduct);
    sourceService.load.mockResolvedValue(familySource);

    await service.replicate(USER_A, ML_PRODUCT_ID);

    expect(sourceService.load).toHaveBeenCalledTimes(1);
    expect(sourceService.load).toHaveBeenCalledWith(
      familyProduct,
      ML_CONNECTION.seller_id,
      ML_ACCESS_TOKEN,
    );
    expect(apiService.post).toHaveBeenCalledTimes(1);
    const payload = apiService.post.mock
      .calls[0]?.[2] as TiendanubeCreateProductDto;
    expect(payload.name).toEqual({ es: 'Remera familiar' });
    expect(payload.visibility).toBe('visible');
    expect(payload.variants).toHaveLength(5);
    expect(payload.variants[0]).toEqual({
      sku: 'FAMILY-38',
      price: '40000.00',
      stock_management: true,
      stock: 0,
      values: [{ es: 'Negro' }, { es: '38' }],
    });
  });

  it('si ya está COMPLETED no vuelve a consultar ML ni a crear', async () => {
    linkRepository.reserve.mockResolvedValue({
      outcome: 'COMPLETED',
      tiendanubeProductId: '12345',
    });

    await expect(service.replicate(USER_A, ML_PRODUCT_ID)).resolves.toEqual({
      ok: true,
      alreadyReplicated: true,
      tiendanubeProductId: '12345',
    });
    expect(tokenService.getValidAccessToken).not.toHaveBeenCalled();
    expect(sourceService.load).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
    expect(linkRepository.complete).not.toHaveBeenCalled();
  });

  it('crea por sourceId y responde action created', async () => {
    await expect(
      service.replicateOrUpdateBySourceId(USER_A, ML_PRODUCT_ID),
    ).resolves.toEqual({
      ok: true,
      action: 'created',
      mercadolibreSourceId: ML_PRODUCT_ID,
      tiendanubeProductId: '7654321',
    });

    expect(apiService.post).toHaveBeenCalledTimes(1);
    expect(apiService.put).not.toHaveBeenCalled();
  });

  it('actualiza por sourceId el producto Tiendanube ya vinculado', async () => {
    linkRepository.reserve.mockResolvedValue({
      outcome: 'COMPLETED',
      tiendanubeProductId: '12345',
    });

    await expect(
      service.replicateOrUpdateBySourceId(USER_A, ML_PRODUCT_ID),
    ).resolves.toEqual({
      ok: true,
      action: 'updated',
      mercadolibreSourceId: ML_PRODUCT_ID,
      tiendanubeProductId: '12345',
    });

    expect(apiService.put).toHaveBeenCalledTimes(1);
    expect(apiService.put).toHaveBeenCalledWith(
      '987654',
      '/products/12345',
      expect.objectContaining({ visibility: 'visible' }),
      TIENDANUBE_ACCESS_TOKEN,
    );
    expect(apiService.post).not.toHaveBeenCalled();
    expect(linkRepository.complete).not.toHaveBeenCalled();
  });

  it('un conflicto de descripción ocurre tras reservar y antes del POST', async () => {
    sourceService.load.mockRejectedValue(
      new ConflictException(
        'La familia tiene descripciones diferentes en Mercado Libre',
      ),
    );

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({ status: 409 });

    expect(linkRepository.reserve).toHaveBeenCalledWith({
      userId: USER_A,
      storeId: '987654',
      mlProductId: ML_PRODUCT_ID,
      mlSourceKey: ML_PRODUCT.external_key,
    });
    expect(sourceService.load).toHaveBeenCalledWith(
      ML_PRODUCT,
      ML_CONNECTION.seller_id,
      ML_ACCESS_TOKEN,
    );
    expect(linkRepository.fail).toHaveBeenCalledWith({
      linkId: LINK_ID,
      userId: USER_A,
      storeId: '987654',
      mlProductId: ML_PRODUCT_ID,
      mlSourceKey: ML_PRODUCT.external_key,
      reservationVersion: RESERVATION_VERSION,
    });
    expect(apiService.post).not.toHaveBeenCalled();
    expect(linkRepository.complete).not.toHaveBeenCalled();
  });

  it('la segunda replicación usa el vínculo completado y hace un solo POST', async () => {
    let completedProductId: string | null = null;
    linkRepository.reserve.mockImplementation(() =>
      Promise.resolve(
        completedProductId
          ? {
              outcome: 'COMPLETED' as const,
              tiendanubeProductId: completedProductId,
            }
          : {
              outcome: 'RESERVED' as const,
              linkId: LINK_ID,
              reservationVersion: RESERVATION_VERSION,
            },
      ),
    );
    linkRepository.complete.mockImplementation((input) => {
      completedProductId = input.tiendanubeProductId;
      return Promise.resolve();
    });

    await expect(service.replicate(USER_A, ML_PRODUCT_ID)).resolves.toEqual({
      ok: true,
      alreadyReplicated: false,
      mlProductId: ML_PRODUCT_ID,
      tiendanubeProductId: '7654321',
    });
    await expect(service.replicate(USER_A, ML_PRODUCT_ID)).resolves.toEqual({
      ok: true,
      alreadyReplicated: true,
      tiendanubeProductId: '7654321',
    });

    expect(linkRepository.reserve).toHaveBeenCalledTimes(2);
    expect(linkRepository.complete).toHaveBeenCalledTimes(1);
    expect(apiService.post).toHaveBeenCalledTimes(1);
  });

  it('si está PENDING responde 409 y no ejecuta el POST', async () => {
    linkRepository.reserve.mockResolvedValue({ outcome: 'PENDING' });

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tokenService.getValidAccessToken).not.toHaveBeenCalled();
    expect(sourceService.load).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('sin conexión ML falla antes de leer datos Tiendanube', async () => {
    tokenService.getStoredConnection.mockRejectedValue(
      new UnauthorizedException('Primero conectá Mercado Libre'),
    );

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(connectionRepository.findCredentialsByUserId).not.toHaveBeenCalled();
    expect(productRepository.findById).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('sin conexión Tiendanube no reserva ni llama a ninguna API', async () => {
    connectionRepository.findCredentialsByUserId.mockResolvedValue(null);

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(productRepository.findById).not.toHaveBeenCalled();
    expect(linkRepository.reserve).not.toHaveBeenCalled();
    expect(tokenService.getValidAccessToken).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('sin write_products no reserva ni llama a Tiendanube', async () => {
    connectionRepository.findCredentialsByUserId.mockResolvedValue({
      storeId: '987654',
      accessToken: TIENDANUBE_ACCESS_TOKEN,
      scope: 'read_products',
    });

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({ status: 403 });
    expect(productRepository.findById).not.toHaveBeenCalled();
    expect(linkRepository.reserve).not.toHaveBeenCalled();
    expect(sourceService.load).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('un producto ajeno no se encuentra dentro del seller del usuario', async () => {
    productRepository.findById.mockResolvedValue(null);

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(productRepository.findById).toHaveBeenCalledWith(
      ML_CONNECTION.seller_id,
      ML_PRODUCT_ID,
    );
    expect(linkRepository.reserve).not.toHaveBeenCalled();
    expect(sourceService.load).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('un fallo previo al POST marca FAILED y nunca llama a Tiendanube', async () => {
    sourceService.load.mockRejectedValue(
      new BadGatewayException('Mercado Libre no completó la solicitud'),
    );

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 502,
    });
    expect(linkRepository.fail).toHaveBeenCalledTimes(1);
    expect(linkRepository.fail).toHaveBeenCalledWith({
      linkId: LINK_ID,
      userId: USER_A,
      storeId: '987654',
      mlProductId: ML_PRODUCT_ID,
      mlSourceKey: ML_PRODUCT.external_key,
      reservationVersion: RESERVATION_VERSION,
    });
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('un rechazo 4xx de Tiendanube marca FAILED', async () => {
    apiService.post.mockRejectedValue(
      new HttpException(
        {
          statusCode: 422,
          message: 'Tiendanube rechazó la solicitud',
          service: 'tiendanube',
        },
        422,
      ),
    );

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 422,
    });
    expect(linkRepository.fail).toHaveBeenCalledTimes(1);
    expect(linkRepository.complete).not.toHaveBeenCalled();
  });

  it('un resultado incierto de red conserva PENDING para evitar duplicados', async () => {
    apiService.post.mockRejectedValue(
      new BadGatewayException('No se pudo conectar con Tiendanube'),
    );

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 502,
    });
    expect(linkRepository.fail).not.toHaveBeenCalled();
    expect(linkRepository.complete).not.toHaveBeenCalled();
  });

  it('un timeout HTTP 408 conserva PENDING porque su resultado es ambiguo', async () => {
    apiService.post.mockRejectedValue(
      new HttpException('Tiendanube agotó el tiempo de respuesta', 408),
    );

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({ status: 408 });
    expect(linkRepository.fail).not.toHaveBeenCalled();
    expect(linkRepository.complete).not.toHaveBeenCalled();
  });

  it('una respuesta 2xx inválida conserva PENDING', async () => {
    apiService.post.mockResolvedValue({ id: null });

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 502,
    });
    expect(linkRepository.fail).not.toHaveBeenCalled();
    expect(linkRepository.complete).not.toHaveBeenCalled();
  });

  it('si falla guardar COMPLETED no repite automáticamente el POST', async () => {
    linkRepository.complete.mockRejectedValueOnce(
      new ServiceUnavailableException(
        'No se pudo completar la replicación de Tiendanube',
      ),
    );

    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 503,
    });
    expect(apiService.post).toHaveBeenCalledTimes(1);
    expect(linkRepository.fail).not.toHaveBeenCalled();

    linkRepository.reserve.mockResolvedValue({ outcome: 'PENDING' });
    await expect(
      service.replicate(USER_A, ML_PRODUCT_ID),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(apiService.post).toHaveBeenCalledTimes(1);
  });
});
