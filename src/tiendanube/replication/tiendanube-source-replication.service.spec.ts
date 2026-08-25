import { ConflictException } from '@nestjs/common';

import type { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import type { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import type { TiendanubeApiService } from '../shared/tiendanube-api.service';
import type { MercadoLibreReplicationSourceResolver } from './mercadolibre-replication-source-resolver';
import type { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';
import type { TiendanubeProductResolver } from './tiendanube-product-resolver';
import { TiendanubeSourceReplicationService } from './tiendanube-source-replication.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const STORE_ID = '123456';
const SOURCE_KEY = 'item:MLA123';
const TOKEN = 'private-token';
const PRODUCT = { name: { es: 'Remera' }, variants: [] } as never;

describe('TiendanubeSourceReplicationService', () => {
  let service: TiendanubeSourceReplicationService;
  let links: { findBySourceKey: jest.Mock; saveSourceLink: jest.Mock };
  let api: { post: jest.Mock; put: jest.Mock };
  let productResolver: { exists: jest.Mock; resolve: jest.Mock };

  beforeEach(() => {
    const token = {
      getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
      getValidAccessToken: jest.fn().mockResolvedValue('ml-token'),
    };
    const connection = {
      findCredentialsByUserId: jest.fn().mockResolvedValue({
        storeId: STORE_ID,
        accessToken: TOKEN,
        scope: 'write_products',
      }),
    };
    links = {
      findBySourceKey: jest.fn().mockResolvedValue(null),
      saveSourceLink: jest.fn().mockResolvedValue(undefined),
    };
    api = {
      post: jest.fn().mockResolvedValue({ id: 99 }),
      put: jest.fn().mockResolvedValue(undefined),
    };
    productResolver = {
      exists: jest.fn().mockResolvedValue(false),
      resolve: jest.fn().mockResolvedValue(null),
    };
    const sourceResolver = {
      resolve: jest.fn().mockResolvedValue({
        sourceKey: SOURCE_KEY,
        product: PRODUCT,
        skus: [],
      }),
    };
    service = new TiendanubeSourceReplicationService(
      token as unknown as MercadolibreTokenService,
      connection as unknown as TiendanubeConnectionRepository,
      links as unknown as TiendanubeProductLinkRepository,
      sourceResolver as unknown as MercadoLibreReplicationSourceResolver,
      productResolver as unknown as TiendanubeProductResolver,
      api as unknown as TiendanubeApiService,
    );
  });

  it('crea cuando no hay vínculo ni SKU coincidente', async () => {
    await expect(service.replicate(USER_ID, SOURCE_KEY)).resolves.toEqual({
      ok: true,
      action: 'created',
      sourceKey: SOURCE_KEY,
      tiendanubeProductId: '99',
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
    expect(links.saveSourceLink).toHaveBeenCalledWith({
      userId: USER_ID,
      storeId: STORE_ID,
      sourceKey: SOURCE_KEY,
      tiendanubeProductId: '99',
    });
  });

  it('actualiza el producto confirmado por el vínculo', async () => {
    links.findBySourceKey.mockResolvedValue({
      sourceKey: SOURCE_KEY,
      tiendanubeProductId: '77',
      status: 'COMPLETED',
    });
    productResolver.exists.mockResolvedValue(true);

    await expect(service.replicate(USER_ID, SOURCE_KEY)).resolves.toMatchObject(
      {
        action: 'updated',
        tiendanubeProductId: '77',
      },
    );
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('descubre un producto existente por SKU', async () => {
    productResolver.resolve.mockResolvedValue('55');

    await service.replicate(USER_ID, SOURCE_KEY);

    expect(api.put).toHaveBeenCalledWith(
      STORE_ID,
      '/products/55',
      PRODUCT,
      TOKEN,
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('propaga conflicto de descubrimiento sin crear ni actualizar', async () => {
    productResolver.resolve.mockRejectedValue(
      new ConflictException('SKU ambiguo'),
    );

    await expect(service.replicate(USER_ID, SOURCE_KEY)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('mantiene el vínculo obsoleto como candidato a descubrimiento', async () => {
    links.findBySourceKey.mockResolvedValue({
      sourceKey: SOURCE_KEY,
      tiendanubeProductId: '44',
      status: 'COMPLETED',
    });
    productResolver.exists.mockResolvedValue(false);

    await service.replicate(USER_ID, SOURCE_KEY);

    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
