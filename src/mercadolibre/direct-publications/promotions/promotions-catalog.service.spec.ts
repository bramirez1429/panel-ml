import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { PublicationSourceService } from '../../publications/sync/publication-source.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import type { MercadoLibreCategoriesService } from './mercadolibre-categories.service';
import type { PromotionCatalogQuery } from './promotions-catalog.types';
import { PromotionsCatalogService } from './promotions-catalog.service';
import type { PromotionsService } from './promotions.service';
import type { MlPromotion, MlPromotions } from './promotions.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SELLER_ID = 42;
const ACCESS_TOKEN = 'private-token';

describe('PromotionsCatalogService', () => {
  it('devuelve MLA clásicos y cada MLA de una familia como filas separadas', async () => {
    const catalog = [
      item('MLA1', 'Clásica'),
      ...Array.from({ length: 4 }, (_, index) =>
        item(`MLA${index + 2}`, `Familiar ${index + 1}`, {
          family_id: '900',
        }),
      ),
    ];
    const { service } = createService([catalog.map(({ id }) => id)], catalog);

    const result = await service.getCatalog(USER_ID, { limit: 20 });

    expect(result.publications).toHaveLength(5);
    expect(result.publications[0]).toMatchObject({
      itemId: 'MLA1',
      familyId: null,
    });
    expect(result.publications.slice(1)).toEqual(
      expect.arrayContaining(
        ['MLA2', 'MLA3', 'MLA4', 'MLA5'].map((itemId) =>
          expect.objectContaining({ itemId, familyId: '900' }),
        ),
      ),
    );
  });

  it('resume started, candidate, pending y ausencia de promociones', async () => {
    const catalog = ['MLA1', 'MLA2', 'MLA3', 'MLA4'].map((id) => item(id, id));
    const promotionMap = new Map<string, MlPromotions>([
      ['MLA1', groups({ status: 'started', type: 'DEAL' })],
      ['MLA2', groups({ status: 'candidate', type: 'CUSTOM_TYPE' })],
      ['MLA3', groups({ status: 'pending', type: 'SMART' })],
      ['MLA4', groups()],
    ]);
    const { service } = createService(
      [catalog.map(({ id }) => id)],
      catalog,
      promotionMap,
    );

    const result = await service.getCatalog(USER_ID, { limit: 20 });

    expect(result.publications.map((row) => row.promotionSummary.status)).toEqual(
      ['ACTIVE', 'AVAILABLE', 'PENDING', 'NONE'],
    );
    expect(result.publications[1]?.promotionSummary.candidateTypes).toEqual([
      'CUSTOM_TYPE',
    ]);
  });

  it('aplica search, categoryId y facets antes de consultar promociones', async () => {
    const catalog = [
      item('MLA1', 'Reméra Algodón Mujer', {
        attributes: [attribute('GENDER', 'Género', 'Mujer')],
      }),
      item('MLA2', 'Remera Algodón Hombre', {
        attributes: [attribute('GENDER', 'Género', 'Hombre')],
      }),
      item('MLA3', 'Remera Algodón Mujer', {
        category_id: 'MLA-CAT-2',
        attributes: [attribute('GENDER', 'Género', 'Mujer')],
      }),
    ];
    const { service, promotions } = createService(
      [catalog.map(({ id }) => id)],
      catalog,
    );

    const result = await service.getCatalog(USER_ID, {
      limit: 20,
      search: 'algodon reme',
      categoryId: 'MLA-CAT-1',
      facetFilters: [{ attributeId: 'GENDER', value: 'mujer' }],
    });

    expect(result.publications.map(({ itemId }) => itemId)).toEqual(['MLA1']);
    expect(promotions.getPromotions).toHaveBeenCalledTimes(1);
    expect(promotions.getPromotions).toHaveBeenCalledWith(
      USER_ID,
      'MLA1',
      ACCESS_TOKEN,
    );
  });

  it('filtra promotionStatus y promotionType sobre tipos dinámicos', async () => {
    const catalog = ['MLA1', 'MLA2', 'MLA3'].map((id) => item(id, id));
    const promotionMap = new Map<string, MlPromotions>([
      ['MLA1', groups({ status: 'candidate', type: 'FLASH_SALE' })],
      ['MLA2', groups({ status: 'candidate', type: 'DEAL' })],
      ['MLA3', groups({ status: 'started', type: 'FLASH_SALE' })],
    ]);
    const { service } = createService(
      [catalog.map(({ id }) => id)],
      catalog,
      promotionMap,
    );

    const result = await service.getCatalog(USER_ID, {
      limit: 20,
      promotionStatus: 'AVAILABLE',
      promotionType: 'FLASH_SALE',
    });

    expect(result.publications.map(({ itemId }) => itemId)).toEqual(['MLA1']);
  });

  it('pagina con cursor y conserva el orden determinístico del scan', async () => {
    const catalog = ['MLA1', 'MLA2', 'MLA3'].map((id) => item(id, id));
    const { service } = createService(
      [catalog.map(({ id }) => id)],
      catalog,
    );

    const first = await service.getCatalog(USER_ID, { limit: 2 });
    const second = await service.getCatalog(USER_ID, {
      limit: 2,
      cursor: 'promotions:2',
    });

    expect(first).toMatchObject({ done: false, nextCursor: 'promotions:2' });
    expect(first.publications.map(({ itemId }) => itemId)).toEqual([
      'MLA1',
      'MLA2',
    ]);
    expect(second).toMatchObject({ done: true, nextCursor: null });
    expect(second.publications.map(({ itemId }) => itemId)).toEqual(['MLA3']);
  });

  it('resuelve conexión, token y promociones exclusivamente para el usuario actual', async () => {
    const { service, token, promotions } = createService(
      [['MLA1']],
      [item('MLA1', 'Producto')],
    );

    await service.getCatalog(USER_ID, { limit: 20 });

    expect(token.getStoredConnection).toHaveBeenCalledWith(USER_ID);
    expect(token.getValidAccessToken).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ user_id: USER_ID, seller_id: SELLER_ID }),
    );
    expect(promotions.getPromotions).toHaveBeenCalledWith(
      USER_ID,
      'MLA1',
      ACCESS_TOKEN,
    );
  });
});

function createService(
  pages: string[][],
  catalog: MlItem[],
  promotionMap = new Map<string, MlPromotions>(),
) {
  const byId = new Map(catalog.map((value) => [value.id, value]));
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({
      user_id: USER_ID,
      seller_id: SELLER_ID,
    }),
    getValidAccessToken: jest.fn().mockResolvedValue(ACCESS_TOKEN),
  };
  const source = {
    fetchNextScanPage: jest.fn(
      (_sellerId: number, _accessToken: string, cursor?: string) => {
        const index = cursor ? Number(cursor.replace('scan:', '')) : 0;
        const itemIds = pages[index] ?? [];
        return Promise.resolve({
          itemIds,
          scrollId: itemIds.length ? `scan:${index + 1}` : null,
        });
      },
    ),
  };
  const items = {
    getMany: jest.fn((ids: string[]) =>
      Promise.resolve(ids.flatMap((id) => byId.get(id) ?? [])),
    ),
  };
  const promotions = {
    getPromotions: jest.fn((_userId: string, itemId: string) =>
      Promise.resolve(promotionMap.get(itemId) ?? groups()),
    ),
  };
  const categories = {
    getMany: jest.fn((ids: string[]) =>
      Promise.resolve(
        new Map(
          [...new Set(ids)].map((id) => [
            id,
            { id, name: `Categoría ${id}`, path: ['Ropa', `Categoría ${id}`] },
          ]),
        ),
      ),
    ),
  };
  return {
    token,
    source,
    items,
    promotions,
    categories,
    service: new PromotionsCatalogService(
      token as unknown as MercadolibreTokenService,
      source as unknown as PublicationSourceService,
      items as unknown as ItemsService,
      promotions as unknown as PromotionsService,
      categories as unknown as MercadoLibreCategoriesService,
    ),
  };
}

function item(
  id: string,
  title: string,
  override: Partial<MlItem> = {},
): MlItem {
  return {
    id,
    title,
    category_id: 'MLA-CAT-1',
    price: 100,
    status: 'active',
    thumbnail: `https://img/${id}.jpg`,
    attributes: [],
    variations: [],
    ...override,
  };
}

function attribute(id: string, name: string, value: string) {
  return { id, name, value_name: value };
}

function groups(promotion?: MlPromotion): MlPromotions {
  const all = promotion ? [promotion] : [];
  return {
    active: all.filter(({ status }) => status === 'started'),
    candidates: all.filter(({ status }) => status === 'candidate'),
    pending: all.filter(({ status }) => status === 'pending'),
    all,
  };
}
