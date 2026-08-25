import { TiendanubeExistingProductSyncService } from './tiendanube-existing-product-sync.service';

describe('TiendanubeExistingProductSyncService', () => {
  const connection = {
    storeId: '123456',
    accessToken: 'private-token',
    scope: 'write_products',
  };
  const source = {
    name: { es: 'Remera' },
    visibility: 'visible' as const,
    description: { es: 'Descripción' },
    attributes: [{ es: 'Color' }],
    images: [{ src: 'https://example.com/a.jpg' }],
    variants: [
      {
        price: '10.00',
        stock_management: true as const,
        stock: 2,
        values: [{ es: 'Rojo' }],
      },
    ],
  };

  it('separa base, variantes e imágenes en endpoints específicos', async () => {
    const api = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue([]),
      post: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    await new TiendanubeExistingProductSyncService(api as never).sync(
      connection,
      '77',
      source,
    );
    const calls = api.put.mock
      .calls as unknown as readonly (readonly unknown[])[];
    const basePayload = calls[0]?.[2] as Record<string, unknown>;
    expect(basePayload.images).toBeUndefined();
    expect(basePayload.variants).toBeUndefined();
    expect(api.put).toHaveBeenNthCalledWith(
      2,
      '123456',
      '/products/77/variants',
      source.variants,
      'private-token',
    );
    expect(api.post).toHaveBeenCalledWith(
      '123456',
      '/products/77/images',
      source.images[0],
      'private-token',
    );
  });

  it('actualiza variante virtual usando el id real', async () => {
    const api = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue([{ id: 501 }]),
      post: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const virtual = {
      ...source,
      attributes: [],
      variants: [{ ...source.variants[0], values: [] }],
    };
    await new TiendanubeExistingProductSyncService(api as never).sync(
      connection,
      '77',
      virtual,
    );
    expect(api.put).toHaveBeenCalledWith(
      '123456',
      '/products/77/variants/501',
      virtual.variants[0],
      'private-token',
    );
  });
});
