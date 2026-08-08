import { BadGatewayException } from '@nestjs/common';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { UserProductsService } from './user-products.service';

type ResponseFactory = (path: string) => unknown;

class ApiStub {
  readonly calls: string[] = [];

  constructor(private readonly responseFactory: ResponseFactory) {}

  /** Simula una consulta tipada al API de Mercado Libre. */
  async get<T>(path: string): Promise<T> {
    this.calls.push(path);
    return (await this.responseFactory(path)) as T;
  }
}

/** Crea el service con un API controlado por la prueba. */
function createService(responseFactory: ResponseFactory = () => null) {
  const api = new ApiStub(responseFactory);
  const service = new UserProductsService(
    api as unknown as MercadolibreApiService,
  );
  return { api, service };
}

describe('UserProductsService', () => {
  it('detecta MLAU de raíz y variations sin duplicarlos', () => {
    const { service } = createService();
    const source = {
      user_product_id: 'MLAU100',
      variations: [
        { user_product_id: 'MLAU200' },
        { user_product_id: 'MLAU100' },
        { user_product_id: null },
      ],
    };

    expect(service.getRootUserProductId(source)).toBe('MLAU100');
    expect(service.getVariationUserProductIds(source)).toEqual([
      'MLAU200',
      'MLAU100',
    ]);
    expect(service.getPublicationUserProductIds(source)).toEqual([
      'MLAU100',
      'MLAU200',
    ]);
  });

  it('consulta y normaliza la metadata de un User Product', async () => {
    const { api, service } = createService(() => ({
      id: 'MLAU123',
      family_id: 8570150160678059,
      name: 'Remera Nena K-pop',
    }));

    await expect(
      service.getUserProductMetadata('MLAU123', 'private-token'),
    ).resolves.toEqual({
      id: 'MLAU123',
      familyId: '8570150160678059',
      name: 'Remera Nena K-pop',
    });
    expect(api.calls).toEqual(['/user-products/MLAU123']);
  });

  it('limita la consulta de metadata a cuatro solicitudes simultáneas', async () => {
    let activeRequests = 0;
    let maximumRequests = 0;
    const { api, service } = createService(async (path) => {
      activeRequests += 1;
      maximumRequests = Math.max(maximumRequests, activeRequests);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeRequests -= 1;
      const id = path.split('/').at(-1) ?? '';
      return { id, family_id: `family-${id}`, name: null };
    });
    const ids = Array.from({ length: 9 }, (_, index) => `MLAU${index + 1}`);

    const metadata = await service.getMetadataMap(
      [...ids, 'MLAU1'],
      'private-token',
    );

    expect(metadata.size).toBe(9);
    expect(api.calls).toHaveLength(9);
    expect(maximumRequests).toBe(4);
  });

  it('rechaza metadata sin family_id válido', async () => {
    const { service } = createService(() => ({ id: 'MLAU123' }));

    await expect(
      service.getUserProductMetadata('MLAU123', 'private-token'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
