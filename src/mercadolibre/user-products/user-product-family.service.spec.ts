import { BadGatewayException } from '@nestjs/common';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { MercadoLibreUserProduct } from './user-product.types';
import { UserProductFamilyService } from './user-product-family.service';
import { UserProductsService } from './user-products.service';

type FamilyFactory = (path: string) => unknown;
type UserProductFactory = (
  id: string,
) => MercadoLibreUserProduct | Promise<MercadoLibreUserProduct>;

class ApiStub {
  readonly calls: string[] = [];

  constructor(private readonly factory: FamilyFactory) {}

  /** Simula una consulta de familia. */
  async get<T>(path: string): Promise<T> {
    this.calls.push(path);
    return (await this.factory(path)) as T;
  }
}

class UserProductsStub {
  readonly calls: string[] = [];

  constructor(private readonly factory: UserProductFactory) {}

  /** Simula la consulta de un User Product. */
  async getUserProduct(id: string): Promise<MercadoLibreUserProduct> {
    this.calls.push(id);
    return this.factory(id);
  }
}

/** Crea el resolvedor con dependencias controladas. */
function createService(
  familyFactory: FamilyFactory,
  userProductFactory: UserProductFactory,
) {
  const api = new ApiStub(familyFactory);
  const userProducts = new UserProductsStub(userProductFactory);
  const service = new UserProductFamilyService(
    api as unknown as MercadolibreApiService,
    userProducts as unknown as UserProductsService,
  );
  return { api, userProducts, service };
}

describe('UserProductFamilyService', () => {
  it('resuelve una familia y cachea todos sus MLAU', async () => {
    const { api, userProducts, service } = createService(
      () => ({
        family_id: 9001,
        site_id: 'MLA',
        user_id: 123,
        user_products_ids: ['MLAU1', 'MLAU2'],
      }),
      (id) => ({
        id,
        family_id: 9001,
        name: id === 'MLAU1' ? 'Azul' : 'Roja',
      }),
    );
    const cache = service.createCache();

    await expect(
      service.resolveFamily('MLAU1', 'private-token', cache),
    ).resolves.toEqual({
      userProductId: 'MLAU1',
      userProductName: 'Azul',
      familyId: '9001',
      userId: 123,
      userProductIds: ['MLAU1', 'MLAU2'],
    });
    await expect(
      service.resolveFamily('MLAU2', 'private-token', cache),
    ).resolves.toMatchObject({ userProductId: 'MLAU2', familyId: '9001' });

    expect(api.calls).toEqual(['/sites/MLA/user-products-families/9001']);
    expect(userProducts.calls).toEqual(['MLAU1', 'MLAU2']);
    expect(cache.familyByUserProduct.has('MLAU1')).toBe(true);
    expect(cache.familyByUserProduct.has('MLAU2')).toBe(true);
  });

  it('deduplica solicitudes concurrentes con Map de Promises', async () => {
    const { api, userProducts, service } = createService(
      async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return {
          family_id: 9001,
          site_id: 'MLA',
          user_id: 123,
          user_products_ids: ['MLAU1'],
        };
      },
      async (id) => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return { id, family_id: 9001, name: 'Azul' };
      },
    );
    const cache = service.createCache();

    await Promise.all([
      service.resolveFamily('MLAU1', 'private-token', cache),
      service.resolveFamily('MLAU1', 'private-token', cache),
    ]);

    expect(userProducts.calls).toEqual(['MLAU1']);
    expect(api.calls).toHaveLength(1);
  });

  it('rechaza cuando un MLAU no pertenece a la familia informada', async () => {
    const { service } = createService(
      () => ({
        family_id: 9001,
        site_id: 'MLA',
        user_id: 123,
        user_products_ids: ['MLAU2'],
      }),
      () => ({ id: 'MLAU1', family_id: 9001 }),
    );

    await expect(
      service.resolveFamily('MLAU1', 'private-token', service.createCache()),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rechaza respuestas de familia con site o IDs inválidos', async () => {
    const { service } = createService(
      () => ({
        family_id: 9001,
        site_id: 'MLB',
        user_id: 123,
        user_products_ids: ['invalid'],
      }),
      () => ({ id: 'MLAU1', family_id: 9001 }),
    );

    await expect(
      service.resolveFamily('MLAU1', 'private-token', service.createCache()),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
