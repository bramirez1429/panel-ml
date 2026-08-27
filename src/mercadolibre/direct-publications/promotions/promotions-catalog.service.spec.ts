import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { PublicationSourceService } from '../../publications/sync/publication-source.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import { PromotionProductGroup } from './promotions-product-group';
import { PromotionsCatalogService } from './promotions-catalog.service';
import type { PromotionsService } from './promotions.service';
import type { MlPromotion, MlPromotions } from './promotions.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token';

describe('PromotionsCatalogService', () => {
  it('incluye sólo los cuatro grupos fijos y conserva cada MLA de una familia', async () => {
    const catalog = [
      item('MLA1', 'Remera', 'MLA-WOMEN_TSHIRTS'),
      item('MLA2', 'Buzo', 'MLA-WOMEN_SWEATSHIRTS', { family_id: '900' }),
      item('MLA3', 'Remera', 'MLA-GIRLS_TSHIRTS', { family_id: '900' }),
      item('MLA4', 'Buzo', 'MLA-GIRLS_SWEATSHIRTS', { family_id: '900' }),
      item('MLA5', 'Zapato', 'MLA-WOMEN_SHOES'),
    ];
    const { service } = createService([catalog.map(({ id }) => id)], catalog);

    const result = await service.getCatalog(USER_ID, { limit: 20 });

    expect(result.publications).toHaveLength(4);
    expect(result.publications.map(({ itemId }) => itemId)).toEqual([
      'MLA1',
      'MLA2',
      'MLA3',
      'MLA4',
    ]);
    expect(result.publications.map(({ productGroup }) => productGroup)).toEqual(
      ['WOMEN_TSHIRT', 'WOMEN_SWEATSHIRT', 'GIRLS_TSHIRT', 'GIRLS_SWEATSHIRT'],
    );
  });

  it('filtra productGroup y search antes de consultar promociones', async () => {
    const catalog = [
      item('MLA1', 'Producto Mujer', 'MLA-WOMEN_TSHIRTS'),
      item('MLA2', 'Producto Niña', 'MLA-GIRLS_TSHIRTS'),
      item('MLA3', 'Otro', 'MLA-WOMEN_SHOES'),
    ];
    const { service, promotions } = createService(
      [catalog.map(({ id }) => id)],
      catalog,
    );

    const result = await service.getCatalog(USER_ID, {
      limit: 20,
      productGroup: PromotionProductGroup.WOMEN_TSHIRT,
      search: 'mujer',
    });

    expect(result.publications.map(({ itemId }) => itemId)).toEqual(['MLA1']);
    expect(promotions.getPromotions).toHaveBeenCalledTimes(1);
  });

  it('resume active y candidates, calcula descuento y mantiene estado', async () => {
    const catalog = [
      item('MLA1', 'Remera', 'MLA-WOMEN_TSHIRTS'),
      item('MLA2', 'Buzo', 'MLA-WOMEN_SWEATSHIRTS'),
    ];
    const promotionMap = new Map<string, MlPromotions>([
      [
        'MLA1',
        groups({
          status: 'started',
          type: 'DEAL',
          price: 70,
          original_price: 100,
        }),
      ],
      [
        'MLA2',
        groups({
          status: 'candidate',
          type: 'FLASH_SALE',
          price: 80,
          original_price: 100,
        }),
      ],
    ]);
    const { service } = createService(
      [catalog.map(({ id }) => id)],
      catalog,
      promotionMap,
    );

    const result = await service.getCatalog(USER_ID, { limit: 20 });

    expect(result.publications[0]).toMatchObject({
      promotionStatus: 'ACTIVE',
      currentPromotion: {
        type: 'DEAL',
        discountPercent: 30,
      },
    });
    expect(result.publications[1]).toMatchObject({
      promotionStatus: 'AVAILABLE',
      hasActivePromotion: false,
      availablePromotionsCount: 1,
    });
  });

  it('marca pending y NONE sin inventar promociones', async () => {
    const catalog = [
      item('MLA1', 'Buzo', 'MLA-WOMEN_SWEATSHIRTS'),
      item('MLA2', 'Remera', 'MLA-GIRLS_TSHIRTS'),
    ];
    const promotionMap = new Map<string, MlPromotions>([
      ['MLA1', groups({ status: 'pending', type: 'DEAL' })],
      ['MLA2', groups()],
    ]);
    const { service } = createService(
      [catalog.map(({ id }) => id)],
      catalog,
      promotionMap,
    );

    const result = await service.getCatalog(USER_ID, { limit: 20 });

    expect(
      result.publications.map(({ promotionStatus }) => promotionStatus),
    ).toEqual(['PENDING', 'NONE']);
    expect(result.publications[1]?.availablePromotionsCount).toBe(0);
  });

  it('se detiene al completar limit y pagina con cursor', async () => {
    const catalog = ['MLA1', 'MLA2', 'MLA3'].map((id) =>
      item(id, id, 'MLA-WOMEN_TSHIRTS'),
    );
    const { service, source } = createService(
      [catalog.map(({ id }) => id)],
      catalog,
    );

    const first = await service.getCatalog(USER_ID, { limit: 2 });
    const second = await service.getCatalog(USER_ID, {
      limit: 2,
      cursor: 'promotions:2',
    });

    expect(first.publications).toHaveLength(2);
    expect(first.nextCursor).toBe('promotions:2');
    expect(second.publications.map(({ itemId }) => itemId)).toEqual(['MLA3']);
    expect(source.fetchNextScanPage).toHaveBeenCalledTimes(3);
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
      seller_id: 42,
    }),
    getValidAccessToken: jest.fn().mockResolvedValue(TOKEN),
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
      Promise.resolve(
        ids.flatMap((id) => (byId.get(id) ? [byId.get(id)] : [])),
      ),
    ),
  };
  const promotions = {
    getPromotions: jest.fn((_userId: string, itemId: string) =>
      Promise.resolve(promotionMap.get(itemId) ?? groups()),
    ),
  };
  return {
    source,
    promotions,
    service: new PromotionsCatalogService(
      token as unknown as MercadolibreTokenService,
      source as unknown as PublicationSourceService,
      items as unknown as ItemsService,
      promotions as unknown as PromotionsService,
    ),
  };
}

function item(
  id: string,
  title: string,
  domain_id: string,
  override: Partial<MlItem> = {},
): MlItem {
  return {
    id,
    title,
    domain_id,
    category_id: 'MLA-CAT',
    price: 100,
    status: 'active',
    thumbnail: `https://img/${id}.jpg`,
    listing_type_id: 'gold_special',
    shipping: { mode: 'me2', logistic_type: 'self_service' },
    ...override,
  };
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
