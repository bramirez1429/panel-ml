import { ProductRankingService } from './product-ranking.service';

describe('ProductRankingService', () => {
  it('agrupa USER_PRODUCT, suma sus hijos una vez y ordena globalmente', async () => {
    const tokenService = {
      getSharedStoredConnection: jest.fn().mockResolvedValue({ seller_id: 77 }),
      getSharedValidAccessToken: jest.fn().mockResolvedValue('token'),
    };
    const scanner = {
      scan: jest.fn(async (_seller: number, _token: string, _cursor: undefined, consume: (items: any[]) => boolean) => {
        consume([
          { id: 'MLA-legacy', title: 'Legacy', sold_quantity: 4, variations: [], thumbnail: 'https://img/legacy.jpg' },
          { id: 'MLA-child-1', title: 'Hijo 1', family_id: 'UP-FAMILY', family_name: 'Familia', user_product_id: 'UP-1', sold_quantity: 7, thumbnail: 'https://img/family.jpg' },
          { id: 'MLA-child-2', title: 'Hijo 2', family_id: 'UP-FAMILY', family_name: 'Familia', user_product_id: 'UP-2', sold_quantity: 3 },
        ]);
        return { reachedEnd: true, nextScrollId: null };
      }),
    };
    const visitsService = {
      getVisits: jest.fn().mockResolvedValue(new Map([
        ['MLA-legacy', 100],
        ['MLA-child-1', 400],
        ['MLA-child-2', 250],
      ])),
    };
    const result = await new ProductRankingService(tokenService as any, scanner as any, {} as any, {} as any, visitsService as any).getRanking(30);
    expect(result.totalProducts).toBe(2);
    expect(result.products.map((product) => product.sold)).toEqual([10, 4]);
    expect(result.products[0].itemIds).toEqual(['MLA-child-1', 'MLA-child-2']);
    expect(result.products[0].userProductIds).toEqual(['UP-1', 'UP-2']);
    expect(result.products[0].thumbnailUrl).toBe('https://img/family.jpg');
    expect(result.products[0].variantsCount).toBe(2);
    expect(result.products[0].visits).toBe(650);
    expect(result.products[1].visits).toBe(100);
    expect(result.visitPeriodDays).toBe(30);
    expect(result.totalVisits).toBe(750);
    expect(visitsService.getVisits).toHaveBeenCalledWith(
      ['MLA-legacy', 'MLA-child-1', 'MLA-child-2'],
      'token',
      30,
    );
    expect(result.products.map((product) => product.sold)).toEqual([10, 4]);
  });

  it('devuelve todas las variantes USER_PRODUCT ordenadas por vendidos', async () => {
    const familiesService = { getFamilyItems: jest.fn().mockResolvedValue({ items: [
      { id: 'MLA2', user_product_id: 'MLAU2', sold_quantity: 2, attributes: [{ id: 'COLOR', value_name: 'Blanco' }, { id: 'SIZE', value_name: 'M' }] },
      { id: 'MLA1', user_product_id: 'MLAU1', sold_quantity: 8, thumbnail: 'https://img/1.jpg', attributes: [{ id: 'COLOR', value_name: 'Negro' }, { id: 'SIZE', value_name: 'S' }] },
    ] }) };
    const tokenService = {
      getSharedStoredConnection: jest.fn().mockResolvedValue({}),
      getSharedValidAccessToken: jest.fn().mockResolvedValue('token'),
    };
    const visitsService = {
      getVisits: jest.fn().mockResolvedValue(new Map([
        ['MLA1', 520],
        ['MLA2', 680],
      ])),
    };
    const service = new ProductRankingService(tokenService as any, {} as any, familiesService as any, {} as any, visitsService as any);
    const result = await service.getVariants('user', 'family', '123', 7);
    expect(result.variants.map(({ itemId, sold }) => [itemId, sold])).toEqual([['MLA1', 8], ['MLA2', 2]]);
    expect(result.variants[0]).toMatchObject({ label: 'Negro / S', userProductId: 'MLAU1', thumbnailUrl: 'https://img/1.jpg' });
    expect(result.variants.map(({ itemId, visits }) => [itemId, visits])).toEqual([['MLA1', 520], ['MLA2', 680]]);
    expect(visitsService.getVisits).toHaveBeenCalledWith(
      ['MLA2', 'MLA1'],
      'token',
      7,
    );
  });

  it('usa sold_quantity de cada variación LEGACY sin duplicar el vendido del padre', async () => {
    const tokenService = { getSharedStoredConnection: jest.fn().mockResolvedValue({}), getSharedValidAccessToken: jest.fn().mockResolvedValue('token') };
    const itemsService = { getOne: jest.fn().mockResolvedValue({
      id: 'MLA1', title: 'Legacy', sold_quantity: 99, thumbnail: 'https://img/main.jpg',
      variations: [
        { id: 11, sold_quantity: 3, attribute_combinations: [{ id: 'COLOR', value_name: 'Rojo' }] },
        { id: 12, sold_quantity: 7, attribute_combinations: [{ id: 'COLOR', value_name: 'Azul' }] },
      ],
    }) };
    const service = new ProductRankingService(tokenService as any, {} as any, {} as any, itemsService as any, {} as any);
    const result = await service.getVariants('user', 'item', 'MLA1', 90);
    expect(result.variants.map(({ sold }) => sold)).toEqual([7, 3]);
    expect(result.variants.reduce((total, variant) => total + variant.sold, 0)).toBe(10);
    expect(result.variants.every(({ visits }) => visits === null)).toBe(true);
  });
});
