import { BadGatewayException } from '@nestjs/common';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { UserProductsService } from './user-products.service';

type ResponseFactory = (path: string) => unknown;

class ApiStub {
  readonly calls: Array<{ path: string; accessToken?: string }> = [];

  constructor(private readonly responseFactory: ResponseFactory) {}

  /** Simula una consulta tipada a Mercado Libre. */
  async get<T>(path: string, accessToken?: string): Promise<T> {
    this.calls.push({ path, accessToken });
    return (await this.responseFactory(path)) as T;
  }
}

/** Crea el service con un API controlado. */
function createService(responseFactory: ResponseFactory = () => null) {
  const api = new ApiStub(responseFactory);
  const service = new UserProductsService(
    api as unknown as MercadolibreApiService,
  );
  return { api, service };
}

describe('UserProductsService', () => {
  it('consulta y sanea un User Product válido', async () => {
    const { api, service } = createService(() => ({
      id: 'MLAU123',
      family_id: 8570150160678059,
      name: 'Remera Nena K-pop',
      access_token: 'must-not-leak',
    }));

    await expect(
      service.getUserProduct('MLAU123', 'private-token'),
    ).resolves.toEqual({
      id: 'MLAU123',
      family_id: 8570150160678059,
      name: 'Remera Nena K-pop',
    });
    expect(api.calls).toEqual([
      { path: '/user-products/MLAU123', accessToken: 'private-token' },
    ]);
  });

  it('rechaza un MLAU inválido antes de consultar la API', async () => {
    const { api, service } = createService();

    await expect(
      service.getUserProduct('MLAUX', 'private-token'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(api.calls).toEqual([]);
  });

  it('rechaza respuestas con un identificador diferente', async () => {
    const { service } = createService(() => ({ id: 'MLAU999' }));

    await expect(
      service.getUserProduct('MLAU123', 'private-token'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
