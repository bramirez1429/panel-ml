import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { UserProductsService } from '../user-products/user-products.service';
import { PublicationGroupsService } from './publication-groups.service';
import { MercadoLibrePublication } from './publication.types';

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

/** Crea los services reales con un API controlado. */
function createServices(responseFactory: ResponseFactory = () => null) {
  const api = new ApiStub(responseFactory);
  const userProducts = new UserProductsService(
    api as unknown as MercadolibreApiService,
  );
  const groups = new PublicationGroupsService(userProducts);
  return { api, groups };
}

/** Crea una publicación externa para las pruebas. */
function publication(
  id: string,
  overrides: MercadoLibrePublication = {},
): MercadoLibrePublication {
  return {
    id,
    title: `Publicación ${id}`,
    status: 'active',
    thumbnail: `https://http2.mlstatic.com/${id}.jpg`,
    price: 35_000,
    ...overrides,
  };
}

describe('PublicationGroupsService', () => {
  it('mantiene SHARED un MLA con MLAU solamente en variations', async () => {
    const { api, groups } = createServices();
    const item = publication('MLA100', {
      title: 'Remeras Nenas Pack X4',
      variations: [
        { id: 1, user_product_id: 'MLAU101' },
        { id: 2, user_product_id: 'MLAU102' },
      ],
    });

    await expect(
      groups.buildPublicationRows([item], 'private-token'),
    ).resolves.toEqual([
      {
        type: 'SHARED',
        parent: {
          id: 'MLA100',
          title: 'Remeras Nenas Pack X4',
          status: 'active',
          thumbnail: 'https://http2.mlstatic.com/MLA100.jpg',
          price: 35_000,
        },
        children: [],
      },
    ]);
    expect(groups.detectPublicationModel(item)).toBe('SHARED');
    expect(api.calls).toEqual([]);
  });

  it('mantiene SHARED un MLAU raíz sin señales del modelo nuevo', async () => {
    const { api, groups } = createServices();
    const item = publication('MLA200', {
      user_product_id: 'MLAU200',
    });

    const rows = await groups.buildPublicationRows([item], 'private-token');

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('SHARED');
    expect(api.calls).toEqual([]);
  });

  it('agrupa dos MLA nuevos de la misma familia con su precio', async () => {
    const metadata = new Map([
      [
        'MLAU111',
        {
          id: 'MLAU111',
          family_id: '8570150160678059',
          name: 'Remera Nena K-pop Azul',
        },
      ],
      [
        'MLAU222',
        {
          id: 'MLAU222',
          family_id: '8570150160678059',
          name: 'Remera Nena K-pop Rosa',
        },
      ],
    ]);
    const { api, groups } = createServices((path) => {
      const id = path.split('/').at(-1) ?? '';
      return metadata.get(id);
    });
    const items = [
      publication('MLA111', {
        family_name: 'Remera Nena K-pop',
        user_product_id: 'MLAU111',
        price: 35_000,
      }),
      publication('MLA222', {
        family_name: 'Remera Nena K-pop',
        user_product_id: 'MLAU222',
        price: 38_000,
      }),
    ];

    const rows = await groups.buildPublicationRows(items, 'private-token');

    expect(rows).toEqual([
      {
        type: 'VARIANT_PRICING',
        parent: {
          familyId: '8570150160678059',
          title: 'Remera Nena K-pop',
        },
        children: [
          {
            id: 'MLA111',
            userProductId: 'MLAU111',
            title: 'Remera Nena K-pop Azul',
            status: 'active',
            price: 35_000,
          },
          {
            id: 'MLA222',
            userProductId: 'MLAU222',
            title: 'Remera Nena K-pop Rosa',
            status: 'active',
            price: 38_000,
          },
        ],
      },
    ]);
    expect(api.calls).toEqual([
      '/user-products/MLAU111',
      '/user-products/MLAU222',
    ]);
  });

  it('crea un solo hijo desde el MLAU raíz aunque existan variations', async () => {
    const { api, groups } = createServices(() => ({
      id: 'MLAU300-ROOT',
      family_id: 'family-300',
      name: 'Producto raíz',
    }));
    const item = publication('MLA300', {
      user_product_id: 'MLAU300-ROOT',
      tags: ['user_product_listing'],
      variations: [
        { id: 1, user_product_id: 'MLAU300-VARIATION-1' },
        { id: 2, user_product_id: 'MLAU300-VARIATION-2' },
      ],
      price: 42_000,
    });

    const rows = await groups.buildPublicationRows([item], 'private-token');

    expect(rows[0]).toMatchObject({
      type: 'VARIANT_PRICING',
      children: [
        {
          id: 'MLA300',
          userProductId: 'MLAU300-ROOT',
          price: 42_000,
        },
      ],
    });
    expect(api.calls).toEqual(['/user-products/MLAU300-ROOT']);
  });
});
