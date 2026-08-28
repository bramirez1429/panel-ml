import { UnauthorizedException } from '@nestjs/common';

import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { PublicationSourceService } from '../../publications/sync/publication-source.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import { PromotionsCampaignsService } from './promotions-campaigns.service';
import type { PromotionsService } from './promotions.service';
import type { MlPromotion, MlPromotions } from './promotions.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token';

describe('PromotionsCampaignsService', () => {
  it('deduplica campaÃ±as de varios MLA y cuenta eligibleItems', async () => {
    const { service } = createService(
      [item('MLA1', 'MLA-WOMEN_TSHIRTS'), item('MLA2', 'MLA-WOMEN_TSHIRTS')],
      new Map([
        ['MLA1', candidates(campaign('C-1', 'Cyber Fest', 'DEAL'))],
        ['MLA2', candidates(campaign('C-1', 'Cyber Fest', 'DEAL'))],
      ]),
    );

    await expect(service.getCampaigns(USER_ID, {})).resolves.toEqual({
      campaigns: [
        expect.objectContaining({
          id: 'C-1',
          name: 'Cyber Fest',
          eligibleItems: 2,
        }),
      ],
    });
  });

  it('mantiene campaÃ±as distintas y las ordena por cobertura', async () => {
    const { service } = createService(
      [item('MLA1', 'MLA-WOMEN_TSHIRTS'), item('MLA2', 'MLA-WOMEN_TSHIRTS')],
      new Map([
        [
          'MLA1',
          candidates(
            campaign('C-1', 'Zeta', 'DEAL'),
            campaign('C-2', 'Alfa', 'SMART'),
          ),
        ],
        ['MLA2', candidates(campaign('C-1', 'Zeta', 'DEAL'))],
      ]),
    );

    const result = await service.getCampaigns(USER_ID, {});

    expect(result.campaigns.map(({ id }) => id)).toEqual(['C-1', 'C-2']);
  });

  it('filtra publicaciones WOMEN', async () => {
    const { service, promotions } = createService(
      [item('MLA1', 'MLA-WOMEN_TSHIRTS'), item('MLA2', 'MLA-GIRLS_TSHIRTS')],
      new Map([
        ['MLA1', candidates(campaign('W', 'Mujer', 'DEAL'))],
        ['MLA2', candidates(campaign('G', 'NiÃ±a', 'DEAL'))],
      ]),
    );

    await expect(
      service.getCampaigns(USER_ID, { audience: 'WOMEN' }),
    ).resolves.toMatchObject({ campaigns: [{ id: 'W' }] });
    expect(promotions.getPromotionsStrict).toHaveBeenCalledTimes(1);
  });

  it('filtra publicaciones GIRLS', async () => {
    const { service } = createService(
      [item('MLA1', 'MLA-WOMEN_TSHIRTS'), item('MLA2', 'MLA-GIRLS_TSHIRTS')],
      new Map([
        ['MLA1', candidates(campaign('W', 'Mujer', 'DEAL'))],
        ['MLA2', candidates(campaign('G', 'NiÃ±a', 'DEAL'))],
      ]),
    );

    await expect(
      service.getCampaigns(USER_ID, { audience: 'GIRLS' }),
    ).resolves.toMatchObject({ campaigns: [{ id: 'G' }] });
  });

  it('usa fallback humano cuando Mercado Libre no informa name', async () => {
    const { service } = createService(
      [item('MLA1', 'MLA-WOMEN_TSHIRTS')],
      new Map([['MLA1', candidates(campaign('C-1', null, 'DEAL'))]]),
    );

    await expect(service.getCampaigns(USER_ID, {})).resolves.toMatchObject({
      campaigns: [{ id: 'C-1', name: 'Oferta especial' }],
    });
  });

  it('no inventa IDs cuando candidate no informa un identificador real', async () => {
    const { service } = createService(
      [item('MLA1', 'MLA-WOMEN_TSHIRTS')],
      new Map([
        [
          'MLA1',
          candidates({ type: 'DEAL', name: 'Sin ID', status: 'candidate' }),
        ],
      ]),
    );

    await expect(service.getCampaigns(USER_ID, {})).resolves.toEqual({
      campaigns: [],
    });
  });

  it('omite el fallo de promociones de un MLA sin romper el listado', async () => {
    const { service } = createService(
      [item('MLA1', 'MLA-WOMEN_TSHIRTS'), item('MLA2', 'MLA-WOMEN_TSHIRTS')],
      new Map([
        ['MLA1', new Error('item failed')],
        ['MLA2', candidates(campaign('C-2', 'Disponible', 'SMART'))],
      ]),
    );

    await expect(service.getCampaigns(USER_ID, {})).resolves.toMatchObject({
      campaigns: [{ id: 'C-2' }],
    });
  });

  it('propaga un error global de autenticaciÃ³n', async () => {
    const { service } = createService(
      [item('MLA1', 'MLA-WOMEN_TSHIRTS')],
      new Map([['MLA1', new UnauthorizedException()]]),
    );

    await expect(service.getCampaigns(USER_ID, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

function createService(
  catalog: MlItem[],
  promotionMap: Map<string, MlPromotions | Error>,
) {
  const byId = new Map(catalog.map((value) => [value.id, value]));
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
    getValidAccessToken: jest.fn().mockResolvedValue(TOKEN),
  };
  const source = {
    fetchNextScanPage: jest.fn((_sellerId, _accessToken, scrollId?: string) =>
      Promise.resolve(
        scrollId
          ? { itemIds: [], scrollId: null }
          : { itemIds: catalog.map(({ id }) => id), scrollId: 'next' },
      ),
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
    getPromotionsStrict: jest.fn((_userId: string, itemId: string) => {
      const result = promotionMap.get(itemId) ?? candidates();
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    }),
  };
  return {
    promotions,
    service: new PromotionsCampaignsService(
      token as unknown as MercadolibreTokenService,
      source as unknown as PublicationSourceService,
      items as unknown as ItemsService,
      promotions as unknown as PromotionsService,
    ),
  };
}

function item(id: string, domain_id: string): MlItem {
  return {
    id,
    title: id,
    domain_id,
    category_id: 'MLA-CAT',
    price: 100,
    status: 'active',
  };
}

function campaign(id: string, name: string | null, type: string): MlPromotion {
  return {
    id,
    name: name ?? undefined,
    type,
    status: 'candidate',
  };
}

function candidates(...values: MlPromotion[]): MlPromotions {
  return { active: [], candidates: values, pending: [], all: values };
}
